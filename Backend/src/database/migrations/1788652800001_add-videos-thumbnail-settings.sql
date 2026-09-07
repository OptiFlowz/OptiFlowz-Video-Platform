-- Up Migration

-- Mux image parameters, for example:
-- {"time": 12.5, "width": 1280, "height": 720, "fit_mode": "preserve"}
-- An empty object means no saved overrides. Existing thumbnail URLs remain
-- the source of truth until the thumbnail handlers migrate their settings.
ALTER TABLE public.videos
ADD COLUMN thumbnail_settings jsonb NOT NULL DEFAULT '{}'::jsonb
CONSTRAINT videos_thumbnail_settings_object_check
CHECK (jsonb_typeof(thumbnail_settings) = 'object');

-- Down Migration

ALTER TABLE public.videos
DROP COLUMN thumbnail_settings;
