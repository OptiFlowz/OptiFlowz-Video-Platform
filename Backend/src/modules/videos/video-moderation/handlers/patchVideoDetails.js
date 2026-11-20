import { scheduleOverview } from '../../../video-indexing/indexing.service.js';
import { writePool } from '../../../../database/index.js';
import { HttpError } from '../../../../common/httpError.js';
import { z } from 'zod';

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

function getAudienceRoleIds(mode, ids) {
  if (mode === undefined) {
    if (ids !== undefined) throw new HttpError(400, { message: 'allowed_role_ids requires audience_mode' });
    return undefined;
  }
  if (mode === 'everyone') {
    if (ids !== undefined && !(Array.isArray(ids) && ids.length === 0)) {
      throw new HttpError(400, { message: 'everyone requires allowed_role_ids to be omitted or empty' });
    }
    return [];
  }
  if (mode !== 'selected_roles') {
    throw new HttpError(400, { message: "audience_mode must be 'everyone' or 'selected_roles'" });
  }
  if (!Array.isArray(ids) || !ids.length) {
    throw new HttpError(400, { message: 'selected_roles requires at least one role ID' });
  }
  for (const id of ids) {
    if (typeof id !== 'string' || !/^[1-9]\d{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n) {
      throw new HttpError(400, { message: 'Each role ID must be a positive bigint string' });
    }
  }
  return [...new Set(ids)];
}

export async function patchVideoDetailsInternal({ params: routeParams, body: inputBody }) {
  const { videoId } = routeParams;

  const {
    title,
    description,
    time,
    tags,
    chapters,
    visibility, // "public" | "private"
    published_at,
    audience_mode,
    show_locked_card,
    allowed_role_ids,
    chairs,
    speakers,
  } = inputBody || {};

  if (isDefined(show_locked_card) && typeof show_locked_card !== 'boolean') {
    throw new HttpError(400, { message: 'show_locked_card must be a boolean' });
  }
  const audienceRoleIds = getAudienceRoleIds(audience_mode, allowed_role_ids);

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

  if (isDefined(published_at) && published_at !== null
    && !z.iso.datetime({ offset: true }).safeParse(published_at).success) {
    throw new HttpError(400, { message: 'published_at must be an ISO timestamp with a timezone, or null' });
  }

  for (const field of ['thumbnail_settings', 'thumbnail_url']) {
    if (Object.hasOwn(inputBody || {}, field)) {
      throw new HttpError(400, { message: field + ' is no longer accepted by this endpoint' });
    }
  }
  if (isDefined(time) && time !== null
    && (!Number.isFinite(time) || time < 0)) {
    throw new HttpError(400, { message: 'time must be a finite non-negative number or null' });
  }

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
    isDefined(time) ||
    isDefined(tags) ||
    isDefined(chapters) ||
    isDefined(visibility) ||
    isDefined(published_at) ||
    isDefined(audience_mode) || isDefined(show_locked_card);

  const anyPeopleField = isDefined(chairs) || isDefined(speakers);

  if (!anyVideoField && !anyPeopleField) {
    throw new HttpError(400, { message: 'No fields provided' });
  }

  const client = await writePool.connect();
  try {
    await client.query('BEGIN');

    // Lock new associations before the video, matching person rename/delete
    // operations so they cannot miss a concurrently attached video.
    if (anyPeopleField) {
      await client.query(
        'SELECT id FROM people WHERE id = ANY($1::uuid[]) ORDER BY id FOR KEY SHARE',
        [[...new Set([...(chairIds || []), ...(speakerIds || [])])]],
      );
    }

    if (audienceRoleIds?.length) {
      const roles = await client.query(
        'SELECT id FROM public.roles WHERE id = ANY($1::bigint[]) ORDER BY id FOR KEY SHARE',
        [audienceRoleIds],
      );
      if (roles.rowCount !== audienceRoleIds.length) {
        throw new HttpError(400, { message: 'One or more selected roles do not exist' });
      }
    }

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

      if (isDefined(time)) {
        set.push(`mux_thumbnail_time = $${i++}`);
        params.push(time);
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

        if (!isDefined(published_at)) {
          if (v === 'public') set.push(`published_at = COALESCE(published_at, NOW())`);
          else set.push(`published_at = NULL`);
        }
      }

      if (isDefined(published_at)) {
        set.push(`published_at = $${i++}::timestamptz`);
        params.push(published_at);
      }

      if (isDefined(show_locked_card)) {
        set.push(`show_locked_card = $${i++}`);
        params.push(show_locked_card);
      }

      if (isDefined(audience_mode)) {
        set.push(`audience_mode = $${i++}`);
        params.push(audience_mode);
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
      const r = await client.query(`SELECT id FROM public.videos WHERE id = $1 FOR UPDATE`, [videoId]);
      if (r.rowCount === 0) {
        await client.query('ROLLBACK');
        throw new HttpError(404, { message: 'Video not found' });
      }
    }

    if (isDefined(audienceRoleIds)) {
      await client.query('DELETE FROM public.video_allowed_roles WHERE video_id = $1', [videoId]);
      if (audienceRoleIds.length) {
        await client.query(
          'INSERT INTO public.video_allowed_roles (video_id, role_id) SELECT $1, unnest($2::bigint[])',
          [videoId, audienceRoleIds],
        );
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

    if ([title, description, tags, chapters, chairs, speakers].some(isDefined)) {
      await scheduleOverview(client, videoId);
    }
    await client.query('COMMIT');

    return {
      success: true,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err instanceof HttpError) throw err;
    console.error('update video error:', err);
    throw new HttpError(500, { message: 'Server error' });
  } finally {
    client.release();
  }
}
