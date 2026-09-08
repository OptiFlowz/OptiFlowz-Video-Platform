-- Up Migration

ALTER TABLE public.videos ADD COLUMN thumbnail_time integer
CONSTRAINT videos_thumbnail_time_check CHECK (thumbnail_time >= 0);

-- Preserve numeric timestamps, rounding down fractional seconds. Invalid or
-- out-of-range values become NULL, which uses the backend's default time.
UPDATE public.videos
SET thumbnail_time = CASE
  WHEN jsonb_typeof(thumbnail_settings->'time') = 'number' THEN
    CASE WHEN (thumbnail_settings->>'time')::numeric BETWEEN 0 AND 2147483647
      THEN floor((thumbnail_settings->>'time')::numeric)::integer
      ELSE NULL END
  ELSE NULL END;

ALTER TABLE public.videos DROP COLUMN thumbnail_settings;

-- Down Migration

ALTER TABLE public.videos ADD COLUMN thumbnail_settings jsonb
CONSTRAINT videos_thumbnail_settings_object_check
CHECK (jsonb_typeof(thumbnail_settings) = 'object');

UPDATE public.videos SET thumbnail_settings = jsonb_build_object('time', thumbnail_time)
WHERE thumbnail_time IS NOT NULL;

ALTER TABLE public.videos DROP COLUMN thumbnail_time;
