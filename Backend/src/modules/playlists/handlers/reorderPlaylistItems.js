import { writePool } from '../../../database/index.js';
import { HttpError } from '../../../common/httpError.js';

export async function reorderPlaylistItemsInternal({ params: routeParams, body: inputBody }) {
  const playlistId = routeParams.playlistId;
  const ordered = inputBody?.ordered_video_ids;

  if (!playlistId) throw new HttpError(400, { message: 'Missing playlistId' });
  if (!Array.isArray(ordered) || ordered.length === 0) {
    throw new HttpError(400, { message: 'ordered_video_ids must be a non-empty array' });
  }

  // dedupe + basic sanitize
  const ids = ordered.map((x) => String(x).trim()).filter(Boolean);
  const unique = [...new Set(ids)];
  if (unique.length !== ids.length) {
    throw new HttpError(400, { message: 'ordered_video_ids contains duplicates' });
  }

  const client = await writePool.connect();
  try {
    await client.query('BEGIN');

    // proveri da svi pripadaju toj playlisti i da nemaš “višak/manjak”
    const dbRes = await client.query(
      `SELECT video_id::text
       FROM public.playlist_items
       WHERE playlist_id = $1`,
      [playlistId],
    );

    const dbIds = dbRes.rows.map((r) => r.video_id);
    const dbSet = new Set(dbIds);

    // 1) svaki prosleđeni mora biti u playlisti
    for (const vid of unique) {
      if (!dbSet.has(vid)) {
        await client.query('ROLLBACK');
        throw new HttpError(400, {
          message: 'ordered_video_ids contains a video that is not in this playlist',
          video_id: vid,
        });
      }
    }

    // 2) moraš poslati SVE iteme (da ne ostane neki bez pozicije)
    if (unique.length !== dbIds.length) {
      await client.query('ROLLBACK');
      throw new HttpError(400, {
        message: 'ordered_video_ids must include all videos currently in the playlist',
        expected_count: dbIds.length,
        got_count: unique.length,
      });
    }

    // UPDATE pozicija na osnovu ordinality
    await client.query(
      `
      WITH ord AS (
        SELECT video_id::uuid, ord::int AS pos
        FROM unnest($2::uuid[]) WITH ORDINALITY AS t(video_id, ord)
      )
      UPDATE public.playlist_items pi
      SET position = ord.pos
      FROM ord
      WHERE pi.playlist_id = $1
        AND pi.video_id = ord.video_id
      `,
      [playlistId, unique],
    );

    await client.query('COMMIT');
    return { success: true, playlist_id: playlistId };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    await client.query('ROLLBACK').catch(() => {});
    if (err?.code === '23505') {
      throw new HttpError(409, { message: 'Position conflict (unique constraint)' });
    }
    console.error('reorderPlaylistItems error:', err);
    throw new HttpError(500, { message: 'Server error' });
  } finally {
    client.release();
  }
}
