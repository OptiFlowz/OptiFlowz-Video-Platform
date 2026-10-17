-- Up Migration

CREATE TYPE public.feedback_visibility AS ENUM ('never', 'after_check', 'after_finish');
CREATE TYPE public.quiz_scoring_mode AS ENUM ('exact_match', 'partial_credit');

ALTER TABLE public.quizzes
    ADD COLUMN min_answered_percentage decimal(5,2) NOT NULL DEFAULT 0
        CHECK (min_answered_percentage BETWEEN 0 AND 100),
    ADD COLUMN min_correct_percentage decimal(5,2) NOT NULL DEFAULT 0
        CHECK (min_correct_percentage BETWEEN 0 AND 100),
    ADD COLUMN correctness_visibility public.feedback_visibility NOT NULL DEFAULT 'after_finish',
    ADD COLUMN correct_answers_visibility public.feedback_visibility NOT NULL DEFAULT 'after_finish',
    ADD COLUMN explanation_visibility public.feedback_visibility NOT NULL DEFAULT 'after_finish',
    ADD COLUMN explanation_incorrect_only boolean NOT NULL DEFAULT false,
    ADD COLUMN allow_answer_changes_after_check boolean NOT NULL DEFAULT false,
    ADD COLUMN allow_attempt_review boolean NOT NULL DEFAULT true,
    ADD COLUMN show_final_score boolean NOT NULL DEFAULT true,
    ADD COLUMN scoring_mode public.quiz_scoring_mode NOT NULL DEFAULT 'exact_match';

-- Down Migration

ALTER TABLE public.quizzes
    DROP COLUMN scoring_mode,
    DROP COLUMN show_final_score,
    DROP COLUMN allow_attempt_review,
    DROP COLUMN allow_answer_changes_after_check,
    DROP COLUMN explanation_incorrect_only,
    DROP COLUMN explanation_visibility,
    DROP COLUMN correct_answers_visibility,
    DROP COLUMN correctness_visibility,
    DROP COLUMN min_correct_percentage,
    DROP COLUMN min_answered_percentage;

DROP TYPE public.quiz_scoring_mode;
DROP TYPE public.feedback_visibility;
