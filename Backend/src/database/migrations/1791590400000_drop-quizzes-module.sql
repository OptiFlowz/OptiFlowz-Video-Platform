-- Up Migration

-- Permanently remove quiz data. Drop children first to respect foreign keys;
-- do not cascade into objects belonging to other modules.
DROP TABLE IF EXISTS public.quiz_attempt_questions;
DROP TABLE IF EXISTS public.quiz_attempts;
DROP TABLE IF EXISTS public.quiz_matching_pairs;
DROP TABLE IF EXISTS public.quiz_question_options;
DROP TABLE IF EXISTS public.quiz_question_sources;
DROP TABLE IF EXISTS public.quiz_access_rules;
DROP TABLE IF EXISTS public.quiz_questions;
DROP TABLE IF EXISTS public.quizzes;

DROP TYPE IF EXISTS public.quiz_answer_result;

-- role_permissions.permission_id cascades, removing quiz grants as well.
DELETE FROM public.permissions WHERE key LIKE 'quizzes.%';

-- Down Migration

DO $$
BEGIN
    RAISE EXCEPTION 'The quizzes module removal is irreversible. Restore a database backup to recover its schema, data and permission grants.';
END
$$;
