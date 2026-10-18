-- Up Migration

CREATE TABLE public.quiz_questions (
    quiz_id uuid NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
    question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
    position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
    max_points decimal(10,2) NOT NULL DEFAULT 1 CHECK (max_points > 0 AND max_points <> 'NaN'::numeric),
    PRIMARY KEY (quiz_id, question_id)
);

CREATE INDEX quiz_questions_question_id_idx ON public.quiz_questions (question_id);

CREATE FUNCTION public.validate_quiz_question_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    quiz_owner uuid;
    question_owner uuid;
BEGIN
    SELECT user_id INTO quiz_owner FROM public.quizzes WHERE id = NEW.quiz_id FOR SHARE;
    SELECT user_id INTO question_owner FROM public.questions WHERE id = NEW.question_id FOR SHARE;
    -- Foreign keys reject missing parents; row locks keep ownership stable.
    IF quiz_owner <> question_owner THEN
        RAISE EXCEPTION 'The question and quiz must belong to the same user'
            USING ERRCODE = '23514', CONSTRAINT = 'quiz_questions_same_user_check';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER quiz_questions_same_user
BEFORE INSERT OR UPDATE OF quiz_id, question_id ON public.quiz_questions
FOR EACH ROW EXECUTE FUNCTION public.validate_quiz_question_owner();

-- Ownership cannot change underneath existing candidate memberships.
CREATE FUNCTION public.protect_quiz_question_parent_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_TABLE_NAME = 'quizzes' THEN
        IF EXISTS (SELECT 1 FROM public.quiz_questions WHERE quiz_id = OLD.id) THEN
            RAISE EXCEPTION 'Cannot change the owner of a quiz with linked questions'
                USING ERRCODE = '23514', CONSTRAINT = 'quiz_questions_same_user_check';
        END IF;
    ELSE
        IF EXISTS (SELECT 1 FROM public.quiz_questions WHERE question_id = OLD.id) THEN
            RAISE EXCEPTION 'Cannot change the owner of a question linked to a quiz'
                USING ERRCODE = '23514', CONSTRAINT = 'quiz_questions_same_user_check';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER quizzes_protect_candidate_owner
BEFORE UPDATE OF user_id ON public.quizzes
FOR EACH ROW WHEN (OLD.user_id IS DISTINCT FROM NEW.user_id)
EXECUTE FUNCTION public.protect_quiz_question_parent_owner();

CREATE TRIGGER questions_protect_quiz_owner
BEFORE UPDATE OF user_id ON public.questions
FOR EACH ROW WHEN (OLD.user_id IS DISTINCT FROM NEW.user_id)
EXECUTE FUNCTION public.protect_quiz_question_parent_owner();

COMMENT ON TABLE public.quiz_questions IS
    'Candidate pool for quiz attempts. Removing a membership preserves the original question.';

-- Down Migration

DROP TRIGGER questions_protect_quiz_owner ON public.questions;
DROP TRIGGER quizzes_protect_candidate_owner ON public.quizzes;
DROP TABLE public.quiz_questions;
DROP FUNCTION public.protect_quiz_question_parent_owner();
DROP FUNCTION public.validate_quiz_question_owner();
