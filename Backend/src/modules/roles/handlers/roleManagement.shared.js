import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';
import {
  hasPermission,
  loadAuthorization,
} from '../../authorization/authorization.service.js';
import { Permissions } from '../../authorization/permission.constants.js';
import {
  canDeleteRole,
  canUpdateRole,
} from '../../authorization/helpers/canManageRole.js';

const permissionIdSchema = z.union([
  z.string().regex(/^[1-9]\d*$/, 'Invalid permission ID'),
  z.number().int().positive().safe(),
]).transform((value) => String(value));

const permissionAssignmentSchema = z.object({
  id: permissionIdSchema,
  effect: z.enum(['allow', 'deny']),
}).strict();

const roleFields = {
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).nullable(),
  color: z.string().trim().regex(/^#[0-9a-f]{6}$/i, 'Color must be a hex value such as #5865F2').nullable(),
  position: z.coerce.number().int().min(1).max(1_000_000),
  permissions: z.array(permissionAssignmentSchema).max(500),
};

export const createRoleSchema = z.object({
  name: roleFields.name,
  description: roleFields.description.optional().default(null),
  color: roleFields.color.optional().default(null),
  position: roleFields.position,
  permissions: roleFields.permissions.optional().default([]),
}).strict();

export const updateRoleSchema = z.object({
  name: roleFields.name.optional(),
  description: roleFields.description.optional(),
  color: roleFields.color.optional(),
  position: roleFields.position.optional(),
  permissions: roleFields.permissions.optional(),
  is_default: z.literal(true, {
    message: 'is_default may only be set to true; select another default role instead of unsetting it',
  }).optional(),
}).strict().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'At least one role field is required' },
);

const roleIdSchema = z.object({
  roleId: z.string().regex(/^[1-9]\d*$/, 'Invalid role ID'),
}).strict();

export function validateBody(schema, body) {
  return validateOrThrow(schema.safeParse(body));
}

export function validateRoleId(params) {
  return validateOrThrow(roleIdSchema.safeParse(params)).roleId;
}

export function httpError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  return error;
}

export async function loadRoleManagerAuthorization(client, actorUserId) {
  const authorization = await loadAuthorization(actorUserId, client);

  if (!hasPermission(authorization, Permissions.ROLES_MANAGE)) {
    throw httpError('You cannot manage roles', 403, 'ROLE_MANAGEMENT_FORBIDDEN');
  }

  return authorization;
}

export function assertCanCreateAtPosition(authorization, position) {
  if (authorization.isOwner) {
    if (position <= 0) {
      throw httpError('Position 0 is reserved for the Owner role', 403);
    }
    return;
  }

  if (position <= authorization.highestRolePosition) {
    throw httpError(
      'A role must be positioned below your highest role',
      403,
      'ROLE_POSITION_FORBIDDEN',
    );
  }
}

export function assertRoleCanBeUpdated(authorization, role) {
  if (role.is_owner) {
    throw httpError('The Owner role cannot be modified', 403, 'OWNER_ROLE_PROTECTED');
  }

  if (!canUpdateRole(authorization, role)) {
    throw httpError('You cannot update this role', 403, 'ROLE_HIERARCHY_FORBIDDEN');
  }
}

export function assertRoleCanBeDeleted(authorization, role) {
  if (role.is_owner) {
    throw httpError('The Owner role cannot be deleted', 403, 'OWNER_ROLE_PROTECTED');
  }

  if (role.is_system) {
    throw httpError('System roles cannot be deleted', 403, 'SYSTEM_ROLE_PROTECTED');
  }

  if (role.is_default) {
    throw httpError('The default role cannot be deleted', 403, 'DEFAULT_ROLE_PROTECTED');
  }

  if (!canDeleteRole(authorization, role)) {
    throw httpError('You cannot delete this role', 403, 'ROLE_HIERARCHY_FORBIDDEN');
  }
}

export async function lockRole(client, roleId) {
  const { rows } = await client.query(
    `
      SELECT
        id,
        name,
        description,
        color,
        position,
        is_system,
        is_default,
        is_owner,
        created_by,
        created_at,
        updated_at
      FROM roles
      WHERE id = $1
      FOR UPDATE
    `,
    [roleId],
  );

  if (!rows[0]) {
    throw httpError('Role not found', 404, 'ROLE_NOT_FOUND');
  }

  return rows[0];
}

export async function assertUniqueRoleName(client, name, excludedRoleId = null) {
  const normalizedName = name.toLowerCase();

  await client.query(
    `SELECT pg_advisory_xact_lock(hashtext($1))`,
    [`role-name:${normalizedName}`],
  );

  const { rowCount } = await client.query(
    `
      SELECT 1
      FROM roles
      WHERE lower(name) = $1
        AND ($2::bigint IS NULL OR id <> $2)
      LIMIT 1
    `,
    [normalizedName, excludedRoleId],
  );

  if (rowCount > 0) {
    throw httpError('A role with this name already exists', 409, 'ROLE_NAME_EXISTS');
  }
}

export function validatePermissionAssignments(assignments, actorAuthorization) {
  const uniqueIds = new Set(assignments.map((assignment) => assignment.id));
  if (uniqueIds.size !== assignments.length) {
    throw httpError('Each permission may only appear once', 400, 'DUPLICATE_PERMISSION');
  }

  if (!actorAuthorization.isOwner) {
    const forbiddenIds = [...uniqueIds].filter(
      (id) => !actorAuthorization.allowedPermissionIds.has(id),
    );

    if (forbiddenIds.length > 0) {
      throw httpError(
        `You cannot grant or deny permission IDs you do not hold: ${forbiddenIds.join(', ')}`,
        403,
        'PERMISSION_ESCALATION',
      );
    }
  }

  return assignments.map((assignment) => ({
    permissionId: assignment.id,
    effect: assignment.effect,
  }));
}

export async function replaceRolePermissions(client, roleId, assignments) {
  await client.query(
    `DELETE FROM role_permissions WHERE role_id = $1`,
    [roleId],
  );

  if (assignments.length === 0) return;

  await client.query(
    `
      INSERT INTO role_permissions (role_id, permission_id, effect)
      SELECT $1, assignment.permission_id, assignment.effect
      FROM unnest($2::bigint[], $3::text[])
        AS assignment(permission_id, effect)
    `,
    [
      roleId,
      assignments.map((assignment) => assignment.permissionId),
      assignments.map((assignment) => assignment.effect),
    ],
  );
}

export async function invalidateRoleMembers(client, roleId) {
  await client.query(
    `
      UPDATE users u
      SET authz_version = authz_version + 1
      FROM user_roles ur
      WHERE ur.user_id = u.id
        AND ur.role_id = $1
    `,
    [roleId],
  );
}

export async function getRoleById(client, roleId) {
  const { rows } = await client.query(
    `
      SELECT
        r.id,
        r.name,
        r.description,
        r.color,
        r.position,
        r.is_system,
        r.is_default,
        r.is_owner,
        r.created_by,
        r.created_at,
        r.updated_at,
        (
          SELECT COUNT(*)::int
          FROM user_roles ur
          WHERE ur.role_id = r.id
        ) AS member_count,
        COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', p.id,
                'key', p.key,
                'effect', rp.effect,
                'group_name', p.group_name,
                'resource_type', p.resource_type,
                'risk_level', p.risk_level
              )
              ORDER BY p.group_name, p.key
            )
            FROM role_permissions rp
            JOIN permissions p ON p.id = rp.permission_id
            WHERE rp.role_id = r.id
          ),
          '[]'::jsonb
        ) AS permissions
      FROM roles r
      WHERE r.id = $1
    `,
    [roleId],
  );

  return rows[0] || null;
}
