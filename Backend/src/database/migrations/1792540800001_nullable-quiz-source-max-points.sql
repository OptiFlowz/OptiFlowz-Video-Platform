-- Up Migration

ALTER TABLE public.quiz_sources ALTER COLUMN max_points DROP NOT NULL;

COMMENT ON COLUMN public.quiz_sources.max_points IS
    'Points override for selected questions; NULL uses each question bank value at attempt creation. Omitted values default to 1.';

-- Down Migration

-- Restore the previous default for sources that inherit question bank points.
UPDATE public.quiz_sources SET max_points = 1 WHERE max_points IS NULL;
ALTER TABLE public.quiz_sources ALTER COLUMN max_points SET NOT NULL;
COMMENT ON COLUMN public.quiz_sources.max_points IS NULL;
