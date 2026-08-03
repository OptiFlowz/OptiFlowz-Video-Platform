import { writePool } from '../../../database/index.js';
import {
  assertRoleCanBeDeleted,
  httpError,
  loadRoleManagerAuthorization,
  lockRole,
  validateRoleId,
} from './roleManagement.shared.js';

export async function deleteRoleInternal(params, actorUserId) {
  if (!actorUserId) throw httpError('Unauthorized', 401);

  const roleId = validateRoleId(params);
  const client = await writePool.connect();

  try {
    await client.query('BEGIN');

    const authorization = await loadRoleManagerAuthorization(client, actorUserId);
    const role = await lockRole(client, roleId);
    assertRoleCanBeDeleted(authorization, role);

    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS member_count FROM user_roles WHERE role_id = $1`,
      [roleId],
    );

    const memberCount = rows[0]?.member_count ?? 0;
    if (memberCount > 0) {
      throw httpError(
        `Remove this role from ${memberCount} member(s) before deleting it`,
        409,
        'ROLE_HAS_MEMBERS',
      );
    }

    await client.query(`DELETE FROM roles WHERE id = $1`, [roleId]);
    await client.query('COMMIT');

    return {
      deleted: true,
      roleId,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
