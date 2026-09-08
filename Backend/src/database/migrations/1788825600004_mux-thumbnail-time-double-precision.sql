-- Up Migration

ALTER TABLE public.videos
  ALTER COLUMN mux_thumbnail_time TYPE double precision USING mux_thumbnail_time::double precision,
  DROP CONSTRAINT videos_mux_thumbnail_time_check;

ALTER TABLE public.videos ADD CONSTRAINT videos_mux_thumbnail_time_check
  CHECK (mux_thumbnail_time >= 0 AND mux_thumbnail_time < 'Infinity'::double precision);

-- Down Migration

-- Reverting to integer seconds discards the fractional part. Out-of-range
-- values deliberately prevent rollback rather than silently losing timestamps.
ALTER TABLE public.videos DROP CONSTRAINT videos_mux_thumbnail_time_check;
ALTER TABLE public.videos ALTER COLUMN mux_thumbnail_time TYPE integer
  USING floor(mux_thumbnail_time)::integer;
ALTER TABLE public.videos ADD CONSTRAINT videos_mux_thumbnail_time_check
  CHECK (mux_thumbnail_time >= 0);
