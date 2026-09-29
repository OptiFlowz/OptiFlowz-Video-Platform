-- Up Migration
ALTER TABLE public.live_streams ADD COLUMN mux_playback_id_pending_deletion text;

-- Down Migration
ALTER TABLE public.live_streams DROP COLUMN mux_playback_id_pending_deletion;
