import { writePool } from '../database/index.js';
import {
  hasPermission,
  loadAuthorization,
} from '../modules/authorization/authorization.service.js';
import { Permissions } from '../modules/authorization/permission.constants.js';

export async function assertVideoOwner(videoId, userId) {
  if (!userId) {
    const error = new Error('Unauthorized');
    error.status = 401;
    throw error;
  }

  const authorization = await loadAuthorization(userId);
  if (
    authorization.isOwner
    || hasPermission(authorization, Permissions.ANALYTICS_VIDEO_ANY_READ)
  ) {
    return;
  }

  const { rowCount } = await writePool.query(
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
