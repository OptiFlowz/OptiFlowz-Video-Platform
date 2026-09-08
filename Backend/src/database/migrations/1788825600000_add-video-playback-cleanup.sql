-- Up Migration

-- Retain the previous ID until Mux confirms deletion, so retries can finish a switch.
ALTER TABLE public.videos ADD COLUMN mux_playback_id_pending_deletion text;

-- Down Migration

ALTER TABLE public.videos DROP COLUMN mux_playback_id_pending_deletion;
