-- Up Migration

CREATE TABLE public.quiz_attempt_questions (
    attempt_id uuid NOT NULL REFERENCES public.quiz_attempts(id) ON DELETE CASCADE,
    question_no integer NOT NULL,
    question_id uuid REFERENCES public.questions(id) ON DELETE SET NULL,
    question_snapshot jsonb NOT NULL,
    max_points decimal(10,2) NOT NULL DEFAULT 1,

    PRIMARY KEY (attempt_id, question_no),
    CONSTRAINT quiz_attempt_questions_attempt_question_unique UNIQUE (attempt_id, question_id)
);

CREATE TABLE public.quiz_attempt_answers (
    attempt_id uuid NOT NULL,
    question_no integer NOT NULL,
    answer jsonb NOT NULL,
    checked_at timestamptz,
    is_correct boolean,
    awarded_points decimal(10,2),
    updated_at timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (attempt_id, question_no),
    CONSTRAINT quiz_attempt_answers_question_fkey
        FOREIGN KEY (attempt_id, question_no)
        REFERENCES public.quiz_attempt_questions (attempt_id, question_no)
        ON DELETE CASCADE
);

-- Down Migration

DROP TABLE public.quiz_attempt_answers;
DROP TABLE public.quiz_attempt_questions;
