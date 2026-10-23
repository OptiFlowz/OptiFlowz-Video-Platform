-- Up Migration

INSERT INTO permissions (key, description, group_name, resource_type, risk_level)
VALUES ('certificates.moderate', 'Certificate Moderation', 'Certificates', 'certificate_template', 'sensitive')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT r.id, p.id, 'allow'
FROM roles r
CROSS JOIN permissions p
WHERE (r.is_owner OR r.name IN ('Administrator', 'Uploader'))
  AND p.key = 'certificates.moderate'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Down Migration

DELETE FROM permissions WHERE key = 'certificates.moderate';
