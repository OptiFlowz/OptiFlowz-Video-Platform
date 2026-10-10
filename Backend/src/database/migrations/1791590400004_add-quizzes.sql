-- Up Migration

CREATE TYPE public.quiz_status AS ENUM (
    'draft',
    'published',
    'archived'
);

CREATE TABLE public.quizzes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    title varchar(255) NOT NULL,
    description text,
    status public.quiz_status NOT NULL DEFAULT 'draft',

    question_count integer NOT NULL CHECK (question_count > 0),
    time_limit_seconds integer CHECK (time_limit_seconds > 0),
    max_attempts integer CHECK (max_attempts > 0),
    passing_score_percentage decimal(5, 2) NOT NULL DEFAULT 50
        CHECK (passing_score_percentage BETWEEN 0 AND 100),

    shuffle_questions boolean NOT NULL DEFAULT true,
    shuffle_options boolean NOT NULL DEFAULT true,
    has_certificate boolean NOT NULL DEFAULT false,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX quizzes_user_id_idx
ON public.quizzes (user_id);

COMMENT ON COLUMN public.quizzes.question_count IS
    'Number of questions selected for one attempt.';
COMMENT ON COLUMN public.quizzes.time_limit_seconds IS
    'Attempt time limit in seconds; NULL means no time limit.';
COMMENT ON COLUMN public.quizzes.max_attempts IS
    'Maximum number of attempts; NULL means unlimited attempts.';
COMMENT ON COLUMN public.quizzes.passing_score_percentage IS
    'Percentage of points required to pass, from 0 through 100.';

-- Down Migration

DROP TABLE public.quizzes;
DROP TYPE public.quiz_status;
