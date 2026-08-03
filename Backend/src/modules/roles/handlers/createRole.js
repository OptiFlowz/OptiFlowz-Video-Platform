import { writePool } from '../../../database/index.js';
import {
  assertCanCreateAtPosition,
  assertUniqueRoleName,
  createRoleSchema,
  getRoleById,
  httpError,
  loadRoleManagerAuthorization,
  replaceRolePermissions,
  validatePermissionAssignments,
  validateBody,
} from './roleManagement.shared.js';

export async function createRoleInternal(body, actorUserId) {
  if (!actorUserId) throw httpError('Unauthorized', 401);

  const data = validateBody(createRoleSchema, body);
  const client = await writePool.connect();

  try {
    await client.query('BEGIN');

    const authorization = await loadRoleManagerAuthorization(client, actorUserId);
    assertCanCreateAtPosition(authorization, data.position);
    await assertUniqueRoleName(client, data.name);

    const permissions = validatePermissionAssignments(data.permissions, authorization);

    const { rows } = await client.query(
      `
        INSERT INTO roles (
          name,
          description,
          color,
          position,
          created_by
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `,
      [
        data.name,
        data.description,
        data.color?.toUpperCase() ?? null,
        data.position,
        actorUserId,
      ],
    );

    const roleId = rows[0].id;
    await replaceRolePermissions(client, roleId, permissions);

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
