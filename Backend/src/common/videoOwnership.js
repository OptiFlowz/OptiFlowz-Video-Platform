// src/common/videoOwnership.js
import { readPool } from '../database/index.js';

export async function assertVideoOwner(videoId, userId) {
  if (!userId) {
    const error = new Error('Unauthorized');
    error.status = 401;
    throw error;
  }

  const { rowCount } = await readPool.query(
    `
      SELECT 1
      FROM videos
      WHERE id = $1
        AND uploaded_by = $2
      LIMIT 1
    `,
    [videoId, userId]
  );

  if (rowCount === 0) {
    const error = new Error('Forbidden');
    error.status = 403;
    throw error;
  }
}