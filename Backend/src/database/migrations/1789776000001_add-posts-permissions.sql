-- Up Migration

INSERT INTO permissions (key, description, group_name, resource_type, risk_level)
VALUES
    ('posts.create', 'Create posts', 'Posts', 'post', 'normal'),
    ('posts.update_own', 'Update posts created by the user', 'Posts', 'post', 'normal'),
    ('posts.update_any', 'Update any post', 'Posts', 'post', 'dangerous'),
    ('posts.delete_own', 'Delete posts created by the user', 'Posts', 'post', 'sensitive'),
    ('posts.delete_any', 'Delete any post', 'Posts', 'post', 'dangerous'),
    ('posts.poll.vote', 'Vote in post polls', 'Posts', 'post', 'normal'),
    ('posts.questioner.answer', 'Answer post questioners', 'Posts', 'post', 'normal')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT r.id, p.id, 'allow'
FROM roles r
CROSS JOIN permissions p
WHERE p.key IN (
    'posts.create',
    'posts.update_own',
    'posts.update_any',
    'posts.delete_own',
    'posts.delete_any',
    'posts.poll.vote',
    'posts.questioner.answer'
)
AND (
    r.name = 'Administrator'
    OR (r.name = 'Viewer' AND p.key IN (
        'posts.poll.vote',
        'posts.questioner.answer'
    ))
    OR (r.name = 'Uploader' AND p.key IN (
        'posts.create',
        'posts.update_own',
        'posts.delete_own'
    ))
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Down Migration

-- Related role_permissions are removed by the existing cascading foreign key.
DELETE FROM permissions
WHERE key IN (
    'posts.create',
    'posts.update_own',
    'posts.update_any',
    'posts.delete_own',
    'posts.delete_any',
    'posts.poll.vote',
    'posts.questioner.answer'
);
