-- Up Migration

ALTER TABLE public.quiz_requirements
    ADD COLUMN is_active boolean NOT NULL DEFAULT true;

-- Down Migration

ALTER TABLE public.quiz_requirements DROP COLUMN is_active;
