-- Up Migration

ALTER TABLE public.videos
ALTER COLUMN thumbnail_settings DROP NOT NULL,
ALTER COLUMN thumbnail_settings DROP DEFAULT;

-- Down Migration

-- The preceding migration already allows NULL; only restore its default.
ALTER TABLE public.videos
ALTER COLUMN thumbnail_settings SET DEFAULT '{}'::jsonb;
