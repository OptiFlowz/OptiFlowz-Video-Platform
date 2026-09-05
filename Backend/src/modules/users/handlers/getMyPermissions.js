import { writePool } from '../../../database/index.js';
import { hasPermission, loadAuthorization } from '../../authorization/authorization.service.js';

export async function getMyPermissionsInternal(userId) {
  if (!userId) {
    const error = new Error('Unauthorized');
    error.status = 401;
    throw error;
  }

  const authorization = await loadAuthorization(userId);

  // Owners bypass individual role permission grants, so include the full catalog.
  if (authorization.isOwner) {
    const { rows } = await writePool.query('SELECT key FROM permissions ORDER BY key ASC');
    return rows.map((permission) => permission.key);
  }

  return [...authorization.permissions.keys()]
    .filter((key) => hasPermission(authorization, key))
    .sort();
}
