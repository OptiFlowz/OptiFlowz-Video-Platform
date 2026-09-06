import { writePool } from '../../../database/index.js';

export async function togglePlaylistSaveInternal(playlistId, userId) {
  const client = await writePool.connect();

  try {
    await client.query('BEGIN');

    // 1) pokušaj INSERT (save)
    const insertRes = await client.query(
      `
      INSERT INTO public.playlist_saves (user_id, playlist_id, created_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (user_id, playlist_id) DO NOTHING
      RETURNING 1;
      `,
      [userId, playlistId],
    );

    let saved;

    if (insertRes.rowCount === 1) {
      // SAVE uspeo -> increment save_count
      saved = true;

      const upd = await client.query(
        `
        UPDATE public.playlists
        SET save_count = COALESCE(save_count, 0) + 1
        WHERE id = $1
        RETURNING save_count;
        `,
        [playlistId],
      );

      if (upd.rowCount === 0) {
        // playlist ne postoji -> rollback + obriši save koji smo ubacili
        throw new Error('PLAYLIST_NOT_FOUND');
      }

      await client.query('COMMIT');
      return { saved: true, save_count: upd.rows[0].save_count };
    }

    // 2) ako INSERT nije uspeo (već postoji), uradi DELETE (unsave)
    const delRes = await client.query(
      `
      DELETE FROM public.playlist_saves
      WHERE user_id = $1 AND playlist_id = $2
      RETURNING 1;
      `,
      [userId, playlistId],
    );

    // Ako iz nekog razloga nema reda (edge-case), tretiraj kao "nije saved"
    if (delRes.rowCount === 0) {
      await client.query('COMMIT');
      return { saved: false, save_count: null };
    }

    saved = false;

    const upd2 = await client.query(
      `
      UPDATE public.playlists
      SET save_count = GREATEST(COALESCE(save_count, 0) - 1, 0)
      WHERE id = $1
      RETURNING save_count;
      `,
      [playlistId],
    );

    if (upd2.rowCount === 0) {
      throw new Error('PLAYLIST_NOT_FOUND');
    }

    await client.query('COMMIT');
    return { saved: false, save_count: upd2.rows[0].save_count };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
