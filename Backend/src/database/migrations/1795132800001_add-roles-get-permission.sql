-- Up Migration

INSERT INTO permissions (key, description, group_name, resource_type, risk_level)
VALUES ('roles.get', 'List roles and their assigned permissions', 'Roles', NULL, 'normal')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT r.id, p.id, 'allow'
FROM roles r CROSS JOIN permissions p
WHERE p.key = 'roles.get'
  AND (r.name IN ('Uploader', 'Administrator') OR r.is_owner)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Down Migration

DELETE FROM permissions WHERE key = 'roles.get';
