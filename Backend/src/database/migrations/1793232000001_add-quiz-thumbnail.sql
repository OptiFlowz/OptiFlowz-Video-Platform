-- Up Migration

ALTER TABLE public.quizzes ADD COLUMN thumbnail_url text;

-- Down Migration

ALTER TABLE public.quizzes DROP COLUMN thumbnail_url;
