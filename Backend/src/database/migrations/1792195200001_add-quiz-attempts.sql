-- Up Migration

CREATE TYPE public.quiz_attempt_status AS ENUM (
    'in_progress',
    'submitted',
    'timed_out',
    'cancelled'
);

CREATE TABLE public.quiz_attempts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_id uuid NOT NULL REFERENCES public.quizzes(id),
    user_id uuid NOT NULL REFERENCES public.users(id),
    attempt_no integer NOT NULL,
    status public.quiz_attempt_status NOT NULL DEFAULT 'in_progress',

    started_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz,
    finished_at timestamptz,

    earned_points decimal(10,2),
    max_points decimal(10,2),
    score_percentage decimal(5,2),
    passed boolean,

    settings_snapshot jsonb NOT NULL,

    CONSTRAINT quiz_attempts_quiz_user_attempt_no_unique UNIQUE (quiz_id, user_id, attempt_no)
);

CREATE INDEX quiz_attempts_user_started_at_idx
ON public.quiz_attempts (user_id, started_at);

CREATE UNIQUE INDEX quiz_attempts_one_active
ON public.quiz_attempts (quiz_id, user_id)
WHERE status = 'in_progress';

-- Down Migration

DROP TABLE public.quiz_attempts;
DROP TYPE public.quiz_attempt_status;
