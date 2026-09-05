import { z } from 'zod';
import { writePool } from '../../../database/index.js';
import { validateOrThrow } from '../../../common/input.validation.js';
import { hasPermission, loadAuthorization } from '../../authorization/authorization.service.js';
import { canManageRole } from '../../authorization/helpers/canManageRole.js';
import { Permissions } from '../../authorization/permission.constants.js';
import { httpError, lockRole } from '../../roles/handlers/roleManagement.shared.js';

function prerequisites(object) {
  const schema = z.object({
    user_id: z.string().uuid('Invalid user ID'),
    role_id: z.union([
      z.string().regex(/^[1-9]\d*$/, 'Invalid role ID'),
      z.number().int().positive().safe(),
    ]).transform(String).refine(
      (value) => BigInt(value) <= 9223372036854775807n,
      'Invalid role ID',
    ),
  }).strict();

  return validateOrThrow(schema.safeParse(object));
}

export async function removeRoleInternal(object, actorUserId) {
  if (!actorUserId) throw httpError('Unauthorized', 401);

  const { user_id, role_id } = prerequisites(object);
  const client = await writePool.connect();

  try {
    await client.query('BEGIN');

    const role = await lockRole(client, role_id);
    const { rows } = await client.query(
      'SELECT id FROM users WHERE id = $1 FOR UPDATE',
      [user_id],
    );
    if (!rows[0]) throw httpError('User not found', 404);

    const authorization = await loadAuthorization(actorUserId, client);
    if (!hasPermission(authorization, Permissions.USERS_ASSIGN_ROLES)) {
      throw httpError('You cannot remove roles from users', 403);
    }
    if (!canManageRole(authorization, role)) {
      throw httpError('You cannot remove this role', 403);
    }

    const targetAuthorization = await loadAuthorization(user_id, client);
    if (
      targetAuthorization.isOwner
      || (!authorization.isOwner
        && targetAuthorization.highestRolePosition <= authorization.highestRolePosition)
    ) {
      throw httpError('You cannot change role assignments for this user', 403);
    }

    const { rows: assignments } = await client.query(
      `
        DELETE FROM user_roles
        WHERE user_id = $1 AND role_id = $2
        RETURNING user_id, role_id, assigned_by, assigned_at, expires_at
      `,
      [user_id, role_id],
    );
    if (!assignments[0]) throw httpError('Role assignment not found', 404);

    await client.query(
      'UPDATE users SET authz_version = authz_version + 1 WHERE id = $1',
      [user_id],
    );

    await client.query('COMMIT');
    return assignments[0];
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
