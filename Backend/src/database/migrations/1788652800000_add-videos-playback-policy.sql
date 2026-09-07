-- Up Migration

-- Existing uploads use public playback IDs; only new videos default to signed.
ALTER TABLE public.videos
ADD COLUMN playback_policy text NOT NULL DEFAULT 'public'
CONSTRAINT videos_playback_policy_check CHECK (playback_policy IN ('public', 'signed'));

ALTER TABLE public.videos
ALTER COLUMN playback_policy SET DEFAULT 'signed';

-- Down Migration

ALTER TABLE public.videos
DROP COLUMN playback_policy;
