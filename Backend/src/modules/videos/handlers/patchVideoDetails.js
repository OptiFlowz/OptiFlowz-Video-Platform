import { writePool } from '../../../database/index.js';
import { extractKeyFromPublicUrl, s3, R2_BUCKET } from '../helpers/videoModeration.shared.js';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { HttpError } from '../../../common/httpError.js';

function isDefined(v) {
  return v !== undefined;
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return null;
  const cleaned = [...new Set(tags.map((x) => String(x).trim()).filter(Boolean))];
  return cleaned;
}

function normalizePeopleArray(arr) {
  if (!Array.isArray(arr)) return null;
  const ids = arr
    .map((x) => (x && typeof x === 'object' ? x.person_id : x))
    .map((x) => String(x || '').trim())
    .filter(Boolean);
  return [...new Set(ids)];
}

function normalizeChapters(chapters) {
  if (!Array.isArray(chapters)) return null;

  const cleaned = chapters
    .map((c) => ({
      title: String(c?.title ?? '').trim(),
      startTime: Number(c?.startTime),
    }))
    .filter((c) => c.title && Number.isFinite(c.startTime) && c.startTime >= 0)
    .sort((a, b) => a.startTime - b.startTime);

  return cleaned;
}

export async function patchVideoDetailsInternal({ params: routeParams, body: inputBody }) {
  const { videoId } = routeParams;

  const {
    title,
    description,
    thumbnail_url,
    tags,
    chapters,
    visibility, // "public" | "private"
    chairs,
    speakers,
  } = inputBody || {};

  // visibility validacija (null ne prihvatamo; ako hoćeš i null->NULL reci)
  let visibilityNorm = undefined;
  if (isDefined(visibility)) {
    visibilityNorm = visibility === null ? 'private' : String(visibility).toLowerCase();
    if (visibilityNorm !== 'public' && visibilityNorm !== 'private') {
      throw new HttpError(400, {
        message: "visibility must be 'public' or 'private' (or null -> private)",
      });
    }
  }

  // --- normalizacije sa podrškom za null (null => brisanje) ---
  const normTags = isDefined(tags) ? (tags === null ? null : normalizeTags(tags)) : undefined;
  if (isDefined(tags) && tags !== null && normTags === null) {
    throw new HttpError(400, { message: 'tags must be an array of strings or null' });
  }

  const normChapters = isDefined(chapters)
    ? chapters === null
      ? null
      : normalizeChapters(chapters)
    : undefined;
  if (isDefined(chapters) && chapters !== null && normChapters === null) {
    throw new HttpError(400, {
      message: 'chapters must be an array of {title, startTime} or null',
    });
  }

  const chairIds = isDefined(chairs)
    ? chairs === null
      ? []
      : normalizePeopleArray(chairs)
    : undefined;
  if (isDefined(chairs) && chairs !== null && chairIds === null) {
    throw new HttpError(400, { message: 'chairs must be an array of {person_id} or ids, or null' });
  }

  const speakerIds = isDefined(speakers)
    ? speakers === null
      ? []
      : normalizePeopleArray(speakers)
    : undefined;
  if (isDefined(speakers) && speakers !== null && speakerIds === null) {
    throw new HttpError(400, {
      message: 'speakers must be an array of {person_id} or ids, or null',
    });
  }

  const anyVideoField =
    isDefined(title) ||
    isDefined(description) ||
    isDefined(thumbnail_url) ||
    isDefined(tags) ||
    isDefined(chapters) ||
    isDefined(visibility);

  const anyPeopleField = isDefined(chairs) || isDefined(speakers);

  if (!anyVideoField && !anyPeopleField) {
    throw new HttpError(400, { message: 'No fields provided' });
  }

  const client = await writePool.connect();
  try {
    let oldThumbnailKey = null;

    if (isDefined(thumbnail_url)) {
      const existingThumb = await client.query(
        `SELECT thumbnail_url FROM public.videos WHERE id = $1 LIMIT 1`,
        [videoId],
      );

      if (existingThumb.rowCount > 0) {
        const oldUrl = existingThumb.rows[0]?.thumbnail_url || null;
        oldThumbnailKey = extractKeyFromPublicUrl(oldUrl);
      }
    }

    await client.query('BEGIN');

    let updatedVideo = null;

    if (anyVideoField) {
      const set = [];
      const params = [videoId];
      let i = 2;

      // title: null => NULL, string => value
      if (isDefined(title)) {
        if (title === null) {
          set.push(`title = NULL`);
        } else {
          set.push(`title = $${i++}`);
          params.push(String(title).trim());
        }
      }

      // description: null => NULL, string => value
      if (isDefined(description)) {
        set.push(`description = $${i++}`);
        params.push(description === null ? null : String(description));
      }

      // thumbnail_url: null => NULL, string => value
      if (isDefined(thumbnail_url)) {
        set.push(`thumbnail_url = $${i++}`);
        params.push(thumbnail_url === null ? null : String(thumbnail_url).trim());
      }

      // tags: null => NULL, array => text[]
      if (isDefined(tags)) {
        if (tags === null) {
          set.push(`tags = NULL`);
        } else {
          set.push(`tags = $${i++}::text[]`);
          params.push(normTags);
        }
      }

      // chapters: null => NULL, array => jsonb
      if (isDefined(chapters)) {
        if (chapters === null) {
          set.push(`chapters = NULL`);
        } else {
          set.push(`chapters = $${i++}::jsonb`);
          params.push(JSON.stringify(normChapters));
        }
      }

      // visibility: public/private (null nije dozvoljen)
      if (isDefined(visibility)) {
        const v = visibilityNorm; // "public" ili "private" (null -> private)

        set.push(`visibility = $${i++}`);
        params.push(v);

        if (v === 'public') set.push(`published_at = NOW()`);
        else set.push(`published_at = NULL`);
      }

      set.push(`updated_at = NOW()`);

      const sql = `
          UPDATE public.videos
          SET ${set.join(', ')}
          WHERE id = $1
          RETURNING id
        `;

      const r = await client.query(sql, params);
      if (r.rowCount === 0) {
        await client.query('ROLLBACK');
        throw new HttpError(404, { message: 'Video not found' });
      }
      updatedVideo = r.rows[0];
    } else {
      const r = await client.query(`SELECT id FROM public.videos WHERE id = $1 LIMIT 1`, [videoId]);
      if (r.rowCount === 0) {
        await client.query('ROLLBACK');
        throw new HttpError(404, { message: 'Video not found' });
      }
    }

    // --- video_chairs ---
    // chairs: undefined => ne diraj, null => obriši sve chairs, array => replace
    // speakers: undefined => ne diraj, null => obriši sve speakers, array => replace
    const peopleResult = { chairs: undefined, speakers: undefined };

    if (isDefined(chairs) || isDefined(speakers)) {
      // normalize: null -> []
      const finalChairs = isDefined(chairs) ? (chairs === null ? [] : chairIds) : null;
      const finalSpeakers = isDefined(speakers) ? (speakers === null ? [] : speakerIds) : null;

      // Ako su oba poslata, izbegni overlap (prioritet: speakers)
      let chairsNoOverlap = finalChairs;
      if (finalChairs && finalSpeakers) {
        const spSet = new Set(finalSpeakers);
        chairsNoOverlap = finalChairs.filter((id) => !spSet.has(id));
      }

      // 1) CHAIRS (type=0): upsert + delete removed (samo ako je chairs poslato)
      if (chairsNoOverlap !== null) {
        await client.query(
          `
      WITH desired AS (
        SELECT unnest($2::uuid[]) AS person_id
      ),
      upserted AS (
        INSERT INTO public.video_chairs (video_id, person_id, type)
        SELECT $1, person_id, 0 FROM desired
        ON CONFLICT (video_id, person_id)
        DO UPDATE SET type = EXCLUDED.type
        RETURNING person_id
      )
      DELETE FROM public.video_chairs vc
      WHERE vc.video_id = $1
        AND vc.type = 0
        AND NOT EXISTS (SELECT 1 FROM desired d WHERE d.person_id = vc.person_id)
      `,
          [videoId, chairsNoOverlap],
        );
      }

      // 2) SPEAKERS (type=1): upsert + delete removed (samo ako je speakers poslato)
      if (finalSpeakers !== null) {
        await client.query(
          `
      WITH desired AS (
        SELECT unnest($2::uuid[]) AS person_id
      ),
      upserted AS (
        INSERT INTO public.video_chairs (video_id, person_id, type)
        SELECT $1, person_id, 1 FROM desired
        ON CONFLICT (video_id, person_id)
        DO UPDATE SET type = EXCLUDED.type
        RETURNING person_id
      )
      DELETE FROM public.video_chairs vc
      WHERE vc.video_id = $1
        AND vc.type = 1
        AND NOT EXISTS (SELECT 1 FROM desired d WHERE d.person_id = vc.person_id)
      `,
          [videoId, finalSpeakers],
        );
      }
    }

    await client.query('COMMIT');

    if (isDefined(thumbnail_url)) {
      const nextUrl = thumbnail_url === null ? null : String(thumbnail_url).trim();
      const nextKey = extractKeyFromPublicUrl(nextUrl);

      if (oldThumbnailKey && oldThumbnailKey !== nextKey) {
        try {
          await s3.send(
            new DeleteObjectCommand({
              Bucket: R2_BUCKET,
              Key: oldThumbnailKey,
            }),
          );
        } catch (e) {
          console.warn('Old video thumbnail delete failed:', e?.message || e);
        }
      }
    }
    return {
      success: true,
    };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    await client.query('ROLLBACK').catch(() => {});
    console.error('update video error:', err);
    throw new HttpError(500, { message: 'Server error' });
  } finally {
    client.release();
  }
}
