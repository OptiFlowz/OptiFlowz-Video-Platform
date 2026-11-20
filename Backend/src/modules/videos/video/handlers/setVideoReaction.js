import { writePool } from '../../../../database/index.js';
import { watchableVideoWhere } from '../../../../common/videoAccess.js';
import { HttpError } from '../../../../common/httpError.js';

export async function setVideoReactionInternal(videoId, userId, reaction) {
  // reaction: "like" | "dislike"
  const client = await writePool.connect();
  const newVal = reaction === 'like' ? 1 : -1;

  try {
    await client.query('BEGIN');
    const video = await client.query(
      `SELECT v.id FROM public.videos v WHERE v.id = $1
       AND ${watchableVideoWhere({ allowLiveRecording: true })} FOR UPDATE OF v`,
      [videoId, userId],
    );
    if (!video.rowCount) throw new HttpError(404, { message: 'Video not found' });

    // Zaključaj red u tabeli reakcija (ako postoji) radi sigurnosti u konkurenciji
    const { rows } = await client.query(
      `SELECT reaction
       FROM video_reactions
       WHERE video_id = $1 AND user_id = $2
       FOR UPDATE`,
      [videoId, userId],
    );

    let status; // "liked" | "disliked" | "none"

    if (rows.length === 0) {
      // Nema reakcije -> upiši novu
      await client.query(
        `INSERT INTO video_reactions (video_id, user_id, reaction)
         VALUES ($1, $2, $3)`,
        [videoId, userId, newVal],
      );

      if (newVal === 1) {
        await client.query(`UPDATE videos SET like_count = like_count + 1 WHERE id = $1`, [
          videoId,
        ]);
        status = 1;
      } else {
        await client.query(`UPDATE videos SET dislike_count = dislike_count + 1 WHERE id = $1`, [
          videoId,
        ]);
        status = -1;
      }
    } else {
      const oldVal = rows[0].reaction;

      if (oldVal === newVal) {
        // Kliknuo isto dugme opet -> toggle OFF (skloni reakciju)
        await client.query(`DELETE FROM video_reactions WHERE video_id = $1 AND user_id = $2`, [
          videoId,
          userId,
        ]);

        if (newVal === 1) {
          await client.query(`UPDATE videos SET like_count = like_count - 1 WHERE id = $1`, [
            videoId,
          ]);
        } else {
          await client.query(`UPDATE videos SET dislike_count = dislike_count - 1 WHERE id = $1`, [
            videoId,
          ]);
        }

        status = 0;
      } else {
        // Prebacio sa like -> dislike ili obrnuto
        await client.query(
          `UPDATE video_reactions SET reaction = $3, created_at = NOW()
           WHERE video_id = $1 AND user_id = $2`,
          [videoId, userId, newVal],
        );

        if (newVal === 1) {
          // dislike -> like
          await client.query(
            `UPDATE videos
             SET like_count = like_count + 1,
                 dislike_count = dislike_count - 1
             WHERE id = $1`,
            [videoId],
          );
          status = 1;
        } else {
          // like -> dislike
          await client.query(
            `UPDATE videos
             SET dislike_count = dislike_count + 1,
                 like_count = like_count - 1
             WHERE id = $1`,
            [videoId],
          );
          status = -1;
        }
      }
    }

    await client.query('COMMIT');
    return { status }; // status ti kaže šta sad važi
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
