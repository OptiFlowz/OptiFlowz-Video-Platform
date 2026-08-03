import { writePool } from '../../../database/index.js';
import {
  assertCanCreateAtPosition,
  assertRoleCanBeUpdated,
  assertUniqueRoleName,
  getRoleById,
  httpError,
  invalidateRoleMembers,
  loadRoleManagerAuthorization,
  lockRole,
  replaceRolePermissions,
  validatePermissionAssignments,
  updateRoleSchema,
  validateBody,
  validateRoleId,
} from './roleManagement.shared.js';

export async function updateRoleInternal(params, body, actorUserId) {
  if (!actorUserId) throw httpError('Unauthorized', 401);

  const roleId = validateRoleId(params);
  const data = validateBody(updateRoleSchema, body);
  const client = await writePool.connect();

  try {
    await client.query('BEGIN');

    const authorization = await loadRoleManagerAuthorization(client, actorUserId);

    if (data.is_default === true) {
      if (!authorization.isOwner) {
        throw httpError(
          'Only the Owner can change the default role',
          403,
          'DEFAULT_ROLE_FORBIDDEN',
        );
      }

      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext('roles:default'))`,
      );
    }

    const currentRole = await lockRole(client, roleId);
    assertRoleCanBeUpdated(authorization, currentRole);

    if (data.position !== undefined) {
      assertCanCreateAtPosition(authorization, data.position);
    }

    if (data.name !== undefined) {
      await assertUniqueRoleName(client, data.name, roleId);
    }

    if (data.is_default === true) {
      await client.query(
        `
          UPDATE roles
          SET is_default = false,
              updated_at = now()
          WHERE is_default = true
            AND id <> $1
        `,
        [roleId],
      );
    }

    const permissions = data.permissions === undefined
      ? null
      : validatePermissionAssignments(data.permissions, authorization);

    const updates = [];
    const values = [];

    for (const field of ['name', 'description', 'color', 'position']) {
      if (data[field] === undefined) continue;
      values.push(field === 'color' ? data[field]?.toUpperCase() ?? null : data[field]);
      updates.push(`${field} = $${values.length}`);
    }

    if (data.is_default === true) {
      updates.push('is_default = true');
    }

    values.push(roleId);
    updates.push('updated_at = now()');

    await client.query(
      `UPDATE roles SET ${updates.join(', ')} WHERE id = $${values.length}`,
      values,
    );

    if (permissions !== null) {
      await replaceRolePermissions(client, roleId, permissions);
    }

    await invalidateRoleMembers(client, roleId);

    const role = await getRoleById(client, roleId);
    await client.query('COMMIT');
    return role;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error?.code === '23505') {
      throw httpError('A role with this name already exists', 409, 'ROLE_NAME_EXISTS');
    }
    if (error?.code === '23503') {
      throw httpError('One or more permission IDs do not exist', 400, 'UNKNOWN_PERMISSION');
    }
    throw error;
  } finally {
    client.release();
  }
}
