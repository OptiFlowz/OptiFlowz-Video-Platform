import { writePool } from '../../../database/index.js';
import { hasPermission } from '../../authorization/authorization.service.js';
import { Permissions } from '../../authorization/permission.constants.js';
import {
  canDeleteRole,
  canUpdateRole,
} from '../../authorization/helpers/canManageRole.js';

export async function getRolesInternal(actorAuthorization) {
  const { rows } = await writePool.query(
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
      ORDER BY r.position ASC, lower(r.name) ASC
    `,
  );

  const canManage = hasPermission(actorAuthorization, Permissions.ROLES_MANAGE);
  return rows.map((role) => ({
    ...role,
    can_update: canManage && canUpdateRole(actorAuthorization, role),
    can_delete: canManage && canDeleteRole(actorAuthorization, role),
  }));
}
