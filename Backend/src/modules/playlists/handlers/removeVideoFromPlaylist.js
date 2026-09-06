import { writePool } from '../../../database/index.js';
import { HttpError } from '../../../common/httpError.js';

export async function removeVideoFromPlaylistInternal({ params: routeParams }) {
  const { playlistId, videoId } = routeParams;

  if (!playlistId || !videoId) {
    throw new HttpError(400, { message: 'playlistId and videoId are required' });
  }

  const client = await writePool.connect();
  try {
    await client.query('BEGIN');

    // Nađi poziciju
    const itemRes = await client.query(
      `
      SELECT position
      FROM public.playlist_items
      WHERE playlist_id = $1 AND video_id = $2
      LIMIT 1
      `,
      [playlistId, videoId],
    );

    if (!itemRes.rowCount) {
      await client.query('ROLLBACK');
      throw new HttpError(404, { message: 'Item not found in playlist' });
    }

    const oldPos = itemRes.rows[0].position;

    // Obriši item
    await client.query(
      `DELETE FROM public.playlist_items WHERE playlist_id = $1 AND video_id = $2`,
      [playlistId, videoId],
    );

    // SAFE shift: svi posle oldPos pomeri -1 (2-step)
    await client.query(
      `
      UPDATE public.playlist_items
      SET position = position + 100000
      WHERE playlist_id = $1 AND position > $2
      `,
      [playlistId, oldPos],
    );

    await client.query(
      `
      UPDATE public.playlist_items
      SET position = position - 100001
      WHERE playlist_id = $1 AND position >= 100000
      `,
      [playlistId],
    );

    await client.query('COMMIT');
    return { success: true, playlist_id: playlistId, video_id: videoId };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    await client.query('ROLLBACK').catch(() => {});
    console.error('removeVideoFromPlaylist error:', err);
    throw new HttpError(500, { message: 'Server error' });
  } finally {
    client.release();
  }
}
