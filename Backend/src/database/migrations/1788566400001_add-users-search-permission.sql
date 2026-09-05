-- Up Migration

INSERT INTO permissions (key, description, group_name, resource_type, risk_level)
VALUES ('users.search', 'Search users and view their role assignments', 'Users', NULL, 'sensitive')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT r.id, p.id, 'allow'
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'Administrator'
  AND p.key = 'users.search'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Down Migration

DELETE FROM permissions WHERE key = 'users.search';
