-- Up Migration

ALTER TABLE public.videos RENAME COLUMN thumbnail_time TO mux_thumbnail_time;
ALTER TABLE public.videos RENAME CONSTRAINT videos_thumbnail_time_check TO videos_mux_thumbnail_time_check;

-- Down Migration

ALTER TABLE public.videos RENAME CONSTRAINT videos_mux_thumbnail_time_check TO videos_thumbnail_time_check;
ALTER TABLE public.videos RENAME COLUMN mux_thumbnail_time TO thumbnail_time;
