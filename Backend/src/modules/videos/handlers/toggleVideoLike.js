import { writePool } from '../../../database/index.js';

export async function toggleVideoLikeInternal(videoId, userId) {
  const client = await writePool.connect();

  try {
    await client.query('BEGIN');

    // Proveri da li like već postoji
    const checkQuery = 'SELECT user_id FROM video_likes WHERE video_id = $1 AND user_id = $2';
    const { rows } = await client.query(checkQuery, [videoId, userId]);

    let isLiked;

    if (rows.length > 0) {
      // Ukloni like
      await client.query('DELETE FROM video_likes WHERE video_id = $1 AND user_id = $2', [
        videoId,
        userId,
      ]);

      await client.query('UPDATE videos SET like_count = like_count - 1 WHERE id = $1', [videoId]);

      isLiked = false;
    } else {
      // Dodaj like
      await client.query('INSERT INTO video_likes (video_id, user_id) VALUES ($1, $2)', [
        videoId,
        userId,
      ]);

      await client.query('UPDATE videos SET like_count = like_count + 1 WHERE id = $1', [videoId]);

      isLiked = true;
    }

    await client.query('COMMIT');
    return isLiked;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Toggle like failed:', error);
    throw error;
  } finally {
    client.release();
  }
}
