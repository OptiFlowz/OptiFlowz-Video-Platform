-- Up Migration

INSERT INTO permissions (key, description, group_name, resource_type, risk_level)
VALUES
    ('collections.create', 'Create collections', 'Collections', 'collection', 'normal'),
    ('collections.update_own', 'Update own collections and their playlist memberships', 'Collections', 'collection', 'normal'),
    ('collections.update_any', 'Update any collection and its playlist memberships', 'Collections', 'collection', 'dangerous'),
    ('collections.delete_own', 'Delete collections created by the user', 'Collections', 'collection', 'sensitive'),
    ('collections.delete_any', 'Delete any collection', 'Collections', 'collection', 'dangerous')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT r.id, p.id, 'allow'
FROM roles r
CROSS JOIN permissions p
WHERE p.key IN (
    'collections.create',
    'collections.update_own',
    'collections.update_any',
    'collections.delete_own',
    'collections.delete_any'
)
AND (
    r.name = 'Administrator'
    OR (r.name = 'Uploader' AND p.key IN (
        'collections.create',
        'collections.update_own',
        'collections.delete_own'
    ))
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Down Migration

-- Related role_permissions are removed by the existing cascading foreign key.
DELETE FROM permissions
WHERE key IN (
    'collections.create',
    'collections.update_own',
    'collections.update_any',
    'collections.delete_own',
    'collections.delete_any'
);
