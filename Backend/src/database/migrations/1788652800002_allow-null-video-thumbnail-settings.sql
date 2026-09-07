-- Up Migration

ALTER TABLE public.videos
ALTER COLUMN thumbnail_settings DROP NOT NULL;

-- Down Migration

-- Restore the previous empty-object representation before requiring a value.
UPDATE public.videos
SET thumbnail_settings = '{}'::jsonb
WHERE thumbnail_settings IS NULL;

ALTER TABLE public.videos
ALTER COLUMN thumbnail_settings SET NOT NULL;
