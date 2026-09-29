-- Up Migration

INSERT INTO permissions (key, description, group_name, resource_type, risk_level)
VALUES
    ('live_streams.create', 'Create livestreams', 'Livestreams', 'live_stream', 'normal'),
    ('live_streams.update_own', 'List and update own livestreams and thumbnails', 'Livestreams', 'live_stream', 'normal'),
    ('live_streams.update_any', 'Update any livestream and its thumbnail', 'Livestreams', 'live_stream', 'dangerous'),
    ('live_streams.delete_own', 'Delete own livestreams and their recordings', 'Livestreams', 'live_stream', 'sensitive'),
    ('live_streams.delete_any', 'Delete any livestream and its recordings', 'Livestreams', 'live_stream', 'dangerous'),
    ('live_streams.stream_own', 'Retrieve encoder credentials for own livestreams', 'Livestreams', 'live_stream', 'sensitive'),
    ('live_streams.stream_any', 'Retrieve encoder credentials for any livestream', 'Livestreams', 'live_stream', 'dangerous')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT r.id, p.id, 'allow'
FROM roles r
CROSS JOIN permissions p
WHERE p.key IN (
    'live_streams.create', 'live_streams.update_own', 'live_streams.update_any',
    'live_streams.delete_own', 'live_streams.delete_any',
    'live_streams.stream_own', 'live_streams.stream_any'
)
AND (
    r.name = 'Administrator'
    OR (r.name = 'Uploader' AND p.key IN (
        'live_streams.create', 'live_streams.update_own',
        'live_streams.delete_own', 'live_streams.stream_own'
    ))
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Down Migration

-- Existing cascading foreign keys remove the corresponding role grants.
DELETE FROM permissions WHERE key IN (
    'live_streams.create', 'live_streams.update_own', 'live_streams.update_any',
    'live_streams.delete_own', 'live_streams.delete_any',
    'live_streams.stream_own', 'live_streams.stream_any'
);
