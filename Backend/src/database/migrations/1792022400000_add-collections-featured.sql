-- Up Migration

ALTER TABLE public.collections ADD COLUMN is_featured boolean NOT NULL DEFAULT false;

INSERT INTO permissions (key, description, group_name, resource_type, risk_level)
VALUES ('collections.feature', 'Set or clear the featured status of collections', 'Collections', 'collection', 'sensitive')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT r.id, p.id, 'allow'
FROM roles r CROSS JOIN permissions p
WHERE p.key = 'collections.feature' AND (r.is_owner OR r.name = 'Administrator')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Down Migration

DELETE FROM permissions WHERE key = 'collections.feature';
ALTER TABLE public.collections DROP COLUMN is_featured;
