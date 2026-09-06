import { writePool } from '../../../database/index.js';
import { HttpError } from '../../../common/httpError.js';

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export async function movePlaylistItemInternal({ params: routeParams, body: inputBody }) {
  const { playlistId } = routeParams;
  const videoId = inputBody?.video_id;
  const toPosRaw = Number(inputBody?.to_position);

  if (!playlistId || !videoId) {
    throw new HttpError(400, { message: 'playlistId and video_id are required' });
  }
  if (!Number.isFinite(toPosRaw)) {
    throw new HttpError(400, { message: 'to_position must be a number' });
  }

  const client = await writePool.connect();
  try {
    await client.query('BEGIN');

    // (Opcionalno) zaključaš listu da nema race condition
    // await client.query(`SELECT 1 FROM public.playlist_items WHERE playlist_id = $1 FOR UPDATE`, [playlistId]);

    // current position
    const curRes = await client.query(
      `
      SELECT position
      FROM public.playlist_items
      WHERE playlist_id = $1 AND video_id = $2
      LIMIT 1
      `,
      [playlistId, videoId],
    );

    if (!curRes.rowCount) {
      await client.query('ROLLBACK');
      throw new HttpError(404, { message: 'Item not found in playlist' });
    }

    const fromPos = curRes.rows[0].position;

    // max position
    const maxRes = await client.query(
      `
      SELECT COALESCE(MAX(position), 0)::int AS max_pos
      FROM public.playlist_items
      WHERE playlist_id = $1
      `,
      [playlistId],
    );
    const maxPos = maxRes.rows[0].max_pos;
    const tempPos = maxPos + 100000;

    const toPos = clamp(Math.trunc(toPosRaw), 1, maxPos);

    if (toPos === fromPos) {
      await client.query('COMMIT');
      return {
        success: true,
        playlist_id: playlistId,
        video_id: videoId,
        from: fromPos,
        to: toPos,
      };
    }

    // 1) privremeno oslobodi poziciju: stavi target item u "temp zonu"
    await client.query(
      `
      UPDATE public.playlist_items
      SET position = $3
      WHERE playlist_id = $1 AND video_id = $2
      `,
      [playlistId, videoId, tempPos],
    );

    if (fromPos < toPos) {
      // moving DOWN:
      // items in (fromPos+1 .. toPos) shift -1
      await client.query(
        `
        UPDATE public.playlist_items
        SET position = position + 100000
        WHERE playlist_id = $1
          AND position BETWEEN $2 AND $3
        `,
        [playlistId, fromPos + 1, toPos],
      );

      await client.query(
        `
        UPDATE public.playlist_items
        SET position = position - 100001
        WHERE playlist_id = $1
          AND position BETWEEN $2 AND $3
        `,
        [playlistId, fromPos + 1 + 100000, toPos + 100000],
      );
    } else {
      // moving UP:
      // items in (toPos .. fromPos-1) shift +1
      await client.query(
        `
        UPDATE public.playlist_items
        SET position = position + 100000
        WHERE playlist_id = $1
          AND position BETWEEN $2 AND $3
        `,
        [playlistId, toPos, fromPos - 1],
      );

      await client.query(
        `
        UPDATE public.playlist_items
        SET position = position - 99999
        WHERE playlist_id = $1
          AND position BETWEEN $2 AND $3
        `,
        [playlistId, toPos + 100000, fromPos - 1 + 100000],
      );
    }

    // 3) stavi target item na toPos
    await client.query(
      `
      UPDATE public.playlist_items
      SET position = $3
      WHERE playlist_id = $1 AND video_id = $2
      `,
      [playlistId, videoId, toPos],
    );

    await client.query('COMMIT');
    return { success: true, playlist_id: playlistId, video_id: videoId, from: fromPos, to: toPos };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    await client.query('ROLLBACK').catch(() => {});
    if (err?.code === '23505') {
      throw new HttpError(409, { message: 'Position conflict (unique constraint)' });
    }
    console.error('movePlaylistItem error:', err);
    throw new HttpError(500, { message: 'Server error' });
  } finally {
    client.release();
  }
}
