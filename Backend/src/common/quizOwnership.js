import { writePool } from '../database/index.js';
import {
  hasPermission,
  loadAuthorization,
} from '../modules/authorization/authorization.service.js';
import { Permissions } from '../modules/authorization/permission.constants.js';

export async function assertQuizOwner(quizId, userId) {
  if (!userId) {
    const error = new Error('Unauthorized');
    error.status = 401;
    throw error;
  }

  const authorization = await loadAuthorization(userId);
  if (
    authorization.isOwner
    || hasPermission(authorization, Permissions.QUIZZES_MANAGE_ANY)
  ) {
    return;
  }

  const { rowCount } = await writePool.query(
    `
      SELECT 1
      FROM quizzes
      WHERE id = $1 AND created_by = $2
      LIMIT 1
    `,
    [quizId, userId]
  );

  if (rowCount === 0) {
    const error = new Error('Forbidden');
    error.status = 403;
    throw error;
  }
}
