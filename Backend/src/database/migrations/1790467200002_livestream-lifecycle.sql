-- Up Migration
ALTER TABLE public.video_views ADD COLUMN is_playing boolean NOT NULL DEFAULT false;
ALTER TABLE public.video_livestreams
  ADD COLUMN last_connection_event_at timestamptz,
  ADD COLUMN policy_sync_pending boolean NOT NULL DEFAULT false,
  ADD COLUMN mux_stream_pending_deletion text;

INSERT INTO permissions (key, description, group_name, resource_type, risk_level) VALUES
 ('analytics.livestream_own.read', 'Read own livestream analytics', 'Analytics', 'livestream', 'normal'),
 ('analytics.livestream_any.read', 'Read any livestream analytics', 'Analytics', 'livestream', 'sensitive')
ON CONFLICT (key) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT rp.role_id, target.id, rp.effect
FROM role_permissions rp JOIN permissions source ON source.id = rp.permission_id
JOIN permissions target ON target.key = replace(source.key, 'analytics.video_', 'analytics.livestream_')
WHERE source.key IN ('analytics.video_own.read', 'analytics.video_any.read')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Down Migration
ALTER TABLE public.video_views DROP COLUMN is_playing;
DELETE FROM permissions WHERE key IN ('analytics.livestream_own.read', 'analytics.livestream_any.read');
ALTER TABLE public.video_livestreams DROP COLUMN policy_sync_pending, DROP COLUMN mux_stream_pending_deletion, DROP COLUMN last_connection_event_at;
