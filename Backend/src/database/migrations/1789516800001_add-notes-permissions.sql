-- Up Migration

INSERT INTO permissions (key, description, group_name, resource_type, risk_level)
VALUES
    ('notes.read_own', 'Read own video notes', 'Notes', 'note', 'normal'),
    ('notes.create', 'Create personal video notes', 'Notes', 'note', 'normal'),
    ('notes.edit_own', 'Edit own video notes', 'Notes', 'note', 'normal'),
    ('notes.delete_own', 'Delete own video notes', 'Notes', 'note', 'normal')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT r.id, p.id, 'allow'
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('Viewer', 'Administrator')
  AND p.key IN ('notes.read_own', 'notes.create', 'notes.edit_own', 'notes.delete_own')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Down Migration

DELETE FROM permissions
WHERE key IN ('notes.read_own', 'notes.create', 'notes.edit_own', 'notes.delete_own');
