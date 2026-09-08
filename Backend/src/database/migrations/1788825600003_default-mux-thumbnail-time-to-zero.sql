-- Up Migration

ALTER TABLE public.videos ALTER COLUMN mux_thumbnail_time SET DEFAULT 0;

-- Down Migration

ALTER TABLE public.videos ALTER COLUMN mux_thumbnail_time DROP DEFAULT;
