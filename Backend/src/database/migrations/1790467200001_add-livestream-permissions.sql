-- Up Migration

INSERT INTO permissions (key, description, group_name, resource_type, risk_level)
VALUES
    ('livestreams.create', 'Create livestreams', 'Livestreams', 'livestream', 'normal'),
    ('livestreams.update_own', 'Update own livestreams', 'Livestreams', 'livestream', 'normal'),
    ('livestreams.update_any', 'Update any livestream', 'Livestreams', 'livestream', 'dangerous'),
    ('livestreams.delete_own', 'Delete own livestreams', 'Livestreams', 'livestream', 'sensitive'),
    ('livestreams.delete_any', 'Delete any livestream', 'Livestreams', 'livestream', 'dangerous'),
    ('livestreams.broadcast_own', 'Access stream credentials and control own broadcasts', 'Livestreams', 'livestream', 'sensitive'),
    ('livestreams.broadcast_any', 'Access stream credentials and control any broadcast', 'Livestreams', 'livestream', 'dangerous'),
    ('livestreams.library.read', 'Browse and watch livestreams and their replays', 'Livestreams', 'livestream', 'normal'),
    ('livestreams.progress.update', 'Update own livestream replay progress', 'Livestreams', 'livestream', 'normal'),
    ('livestreams.react', 'React to livestreams', 'Livestreams', 'livestream', 'normal')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT r.id, p.id, 'allow'
FROM roles r CROSS JOIN permissions p
WHERE p.key IN (
    'livestreams.create', 'livestreams.update_own', 'livestreams.update_any',
    'livestreams.delete_own', 'livestreams.delete_any',
    'livestreams.broadcast_own', 'livestreams.broadcast_any',
    'livestreams.library.read', 'livestreams.progress.update', 'livestreams.react'
)
AND (
    r.name = 'Administrator'
    OR (r.name = 'Uploader' AND p.key IN (
        'livestreams.create', 'livestreams.update_own',
        'livestreams.delete_own', 'livestreams.broadcast_own'
    ))
    OR (r.name = 'Viewer' AND p.key IN (
        'livestreams.library.read', 'livestreams.progress.update', 'livestreams.react'
    ))
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Down Migration

DELETE FROM permissions WHERE key IN (
    'livestreams.create', 'livestreams.update_own', 'livestreams.update_any',
    'livestreams.delete_own', 'livestreams.delete_any',
    'livestreams.broadcast_own', 'livestreams.broadcast_any',
    'livestreams.library.read', 'livestreams.progress.update', 'livestreams.react'
);
