-- Up Migration

ALTER TABLE public.quizzes
    ADD COLUMN questions_per_page integer NOT NULL DEFAULT 1,
    ADD CONSTRAINT quizzes_questions_per_page_check CHECK (questions_per_page > 0);

-- Down Migration

ALTER TABLE public.quizzes DROP COLUMN questions_per_page;
