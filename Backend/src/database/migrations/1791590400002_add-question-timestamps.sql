-- Up Migration

ALTER TABLE public.questions
    ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX questions_user_created_at_idx
ON public.questions (user_id, created_at, id);

CREATE INDEX questions_user_updated_at_idx
ON public.questions (user_id, updated_at, id);

COMMENT ON COLUMN public.questions.updated_at IS
    'Updated by question CRUD on every edit, including edits to options or matching items.';

-- Down Migration

DROP INDEX public.questions_user_updated_at_idx;
DROP INDEX public.questions_user_created_at_idx;

ALTER TABLE public.questions
    DROP COLUMN updated_at,
    DROP COLUMN created_at;
