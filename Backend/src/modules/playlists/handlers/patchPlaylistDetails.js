import { writePool } from '../../../database/index.js';
import { HttpError } from '../../../common/httpError.js';

function isDefined(v) {
  return v !== undefined;
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return null;
  const cleaned = [...new Set(tags.map((x) => String(x).trim()).filter(Boolean))];
  return cleaned;
}

export async function patchPlaylistDetailsInternal({ params: routeParams, body: inputBody }) {
  const { playlistId } = routeParams;

  const {
    title,
    description,
    tags,
    status, // "public" | "private"  (null -> private)
    featured, // boolean
  } = inputBody || {};

  // status validacija + null -> private
  let statusNorm = undefined;
  if (isDefined(status)) {
    statusNorm = status === null ? 'private' : String(status).toLowerCase();
    if (statusNorm !== 'public' && statusNorm !== 'private') {
      throw new HttpError(400, {
        message: "status must be 'public' or 'private' (or null -> private)",
      });
    }
  }

  // featured validacija (dozvoli null da obriše)
  if (isDefined(featured) && typeof featured !== 'boolean') {
    throw new HttpError(400, { message: 'featured must be boolean' });
  }

  // tags normalizacija (null -> brisanje)
  const normTags = isDefined(tags) ? (tags === null ? null : normalizeTags(tags)) : undefined;
  if (isDefined(tags) && tags !== null && normTags === null) {
    throw new HttpError(400, { message: 'tags must be an array of strings or null' });
  }

  const anyField =
    isDefined(title) ||
    isDefined(description) ||
    isDefined(tags) ||
    isDefined(status) ||
    isDefined(featured);

  if (!anyField) {
    throw new HttpError(400, { message: 'No fields provided' });
  }

  const client = await writePool.connect();
  try {
    await client.query('BEGIN');

    const set = [];
    const params = [playlistId];
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

    // tags: null => NULL, array => text[]
    if (isDefined(tags)) {
      if (tags === null) {
        set.push(`tags = NULL`);
      } else {
        set.push(`tags = $${i++}::text[]`);
        params.push(normTags);
      }
    }

    // status: null -> private (ne NULL)
    if (isDefined(status)) {
      set.push(`status = $${i++}`);
      params.push(statusNorm);
    }

    // featured: null -> NULL, boolean -> value
    if (isDefined(featured)) {
      if (featured === null) {
        set.push(`featured = NULL`);
      } else {
        set.push(`featured = $${i++}`);
        params.push(featured);
      }
    }

    set.push(`updated_at = NOW()`);

    const sql = `
      UPDATE public.playlists
      SET ${set.join(', ')}
      WHERE id = $1
      RETURNING id
    `;

    const r = await client.query(sql, params);
    if (r.rowCount === 0) {
      await client.query('ROLLBACK');
      throw new HttpError(404, { message: 'Playlist not found' });
    }

    await client.query('COMMIT');
    return { success: true };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    await client.query('ROLLBACK').catch(() => {});
    console.error('update playlist error:', err);
    throw new HttpError(500, { message: 'Server error' });
  } finally {
    client.release();
  }
}
