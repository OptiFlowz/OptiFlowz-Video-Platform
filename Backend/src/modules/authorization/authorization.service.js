import { writePool } from '../../database/index.js';

export async function loadAuthorization(userId,database = writePool) {
  const { rows: roleRows } = await database.query(
    `
      SELECT
        r.id,
        r.name,
        r.position,
        r.is_owner
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = $1
        AND (
          ur.expires_at IS NULL
          OR ur.expires_at > now()
        )
      ORDER BY r.position ASC
    `,
    [userId],
  );

  const { rows: permissionRows } = await database.query(
    `
      SELECT
        p.id,
        p.key,
        bool_or(rp.effect = 'allow') AS has_allow,
        bool_or(rp.effect = 'deny') AS has_deny
      FROM user_roles ur
      JOIN role_permissions rp
        ON rp.role_id = ur.role_id
      JOIN permissions p
        ON p.id = rp.permission_id
      WHERE ur.user_id = $1
        AND (
          ur.expires_at IS NULL
          OR ur.expires_at > now()
        )
      GROUP BY p.id, p.key
    `,
    [userId],
  );

  const permissions = new Map();
  const allowedPermissionIds = new Set();

  for (const row of permissionRows) {
    const effect = row.has_deny ? 'deny' : row.has_allow ? 'allow' : null;
    permissions.set(row.key, effect);

    if (effect === 'allow') {
      allowedPermissionIds.add(String(row.id));
    }
  }

  return {
    userId,
    roles: roleRows,
    roleIds: roleRows.map((role) => role.id),
    isOwner: roleRows.some((role) => role.is_owner),
    highestRolePosition:
      roleRows.length > 0
        ? Math.min(...roleRows.map((role) => role.position))
        : Number.MAX_SAFE_INTEGER,
    permissions,
    allowedPermissionIds,
  };
}

export function hasPermission(authorization, permissionKey) {
  if (authorization.isOwner) {
    return true;
  }

  return authorization.permissions.get(permissionKey) === 'allow';
}
