import { writePool } from '../../../database/index.js';
import { HttpError } from '../../../common/httpError.js';

function toIntOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export async function addVideoToPlaylistInternal({ params: routeParams, body: inputBody }) {
  const playlistId = routeParams.playlistId;
  const videoId = inputBody?.video_id;
  const position = toIntOrNull(inputBody?.position); // optional

  if (!playlistId || !videoId) {
    throw new HttpError(400, { message: 'playlistId and video_id are required' });
  }

  const client = await writePool.connect();
  try {
    await client.query('BEGIN');

    // (opciono) proveri da playlist postoji
    const pl = await client.query(`SELECT id FROM public.playlists WHERE id = $1 LIMIT 1`, [
      playlistId,
    ]);
    if (!pl.rowCount) {
      await client.query('ROLLBACK');
      throw new HttpError(404, { message: 'Playlist not found' });
    }

    // (opciono) proveri da video postoji
    const v = await client.query(`SELECT id FROM public.videos WHERE id = $1 LIMIT 1`, [videoId]);
    if (!v.rowCount) {
      await client.query('ROLLBACK');
      throw new HttpError(404, { message: 'Video not found' });
    }

    // već u playlisti?
    const exists = await client.query(
      `SELECT 1 FROM public.playlist_items WHERE playlist_id = $1 AND video_id = $2 LIMIT 1`,
      [playlistId, videoId],
    );
    if (exists.rowCount) {
      await client.query('ROLLBACK');
      throw new HttpError(409, { message: 'Video already in playlist' });
    }

    // odredi target poziciju
    let targetPos = position;

    const maxRes = await client.query(
      `SELECT COALESCE(MAX(position), 0)::int AS max_pos
       FROM public.playlist_items
       WHERE playlist_id = $1`,
      [playlistId],
    );
    const maxPos = maxRes.rows[0].max_pos;

    if (targetPos === null) {
      targetPos = maxPos + 1; // na kraj
    } else {
      // clamp u opseg 1..maxPos+1
      if (targetPos < 1) targetPos = 1;
      if (targetPos > maxPos + 1) targetPos = maxPos + 1;

      // pomeri postojeće na >= targetPos
      await client.query(
        `
        -- 1) u privremenu zonu
        UPDATE public.playlist_items
        SET position = position + 100000
        WHERE playlist_id = $1 AND position >= $2
        `,
        [playlistId, targetPos],
      );

      await client.query(
        `
        -- 2) vrati iz privremene zone na final (+1)
        UPDATE public.playlist_items
        SET position = position - 99999
        WHERE playlist_id = $1 AND position >= $2 + 100000
        `,
        [playlistId, targetPos],
      );
    }

    await client.query(
      `
      INSERT INTO public.playlist_items (playlist_id, video_id, position)
      VALUES ($1, $2, $3)
      `,
      [playlistId, videoId, targetPos],
    );

    await client.query('COMMIT');
    return {
      success: true,
      playlist_id: playlistId,
      video_id: videoId,
      position: targetPos,
    };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    await client.query('ROLLBACK').catch(() => {});
    // unique constraint fallback
    if (err?.code === '23505') {
      throw new HttpError(409, { message: 'Duplicate playlist item (video or position)' });
    }
    console.error('addVideoToPlaylist error:', err);
    throw new HttpError(500, { message: 'Server error' });
  } finally {
    client.release();
  }
}
