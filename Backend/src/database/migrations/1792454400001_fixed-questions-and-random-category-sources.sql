-- Up Migration

-- Convert legacy percentages using largest remainders and the old quiz size.
DROP TRIGGER quiz_sources_allocation ON public.quiz_sources;
DROP TRIGGER quizzes_source_allocation ON public.quizzes;
DROP FUNCTION public.validate_quiz_source_allocation();
DROP FUNCTION public.assert_quiz_source_allocation(uuid);
ALTER TABLE public.quiz_sources DROP CONSTRAINT quiz_sources_one_mode_check;
ALTER TABLE public.quiz_sources DROP CONSTRAINT quiz_sources_count_check;
WITH quotas AS (
    SELECT s.id, s.quiz_id, s.position, s.category_id, q.question_count AS total,
        floor(q.question_count::numeric * s.question_percentage / 100)::integer AS base,
        mod(q.question_count::numeric * s.question_percentage, 100) AS remainder
    FROM public.quiz_sources s JOIN public.quizzes q ON q.id=s.quiz_id
    WHERE s.question_percentage IS NOT NULL
), ranked AS (
    SELECT *, row_number() OVER (PARTITION BY quiz_id ORDER BY remainder DESC, position, category_id NULLS LAST, id) AS rank,
        total - sum(base) OVER (PARTITION BY quiz_id) AS extra FROM quotas
)
UPDATE public.quiz_sources s SET question_count = r.base + CASE WHEN r.rank <= r.extra THEN 1 ELSE 0 END
FROM ranked r WHERE s.id=r.id;
-- Zero-sized legacy percentage blocks selected no questions and are no longer sources.
DELETE FROM public.quiz_sources WHERE question_count=0;
ALTER TABLE public.quiz_sources DROP COLUMN question_percentage;
ALTER TABLE public.quiz_sources ALTER COLUMN question_count SET NOT NULL;
ALTER TABLE public.quiz_sources ADD CONSTRAINT quiz_sources_count_check CHECK (question_count > 0);
ALTER TABLE public.quiz_sources ADD COLUMN max_points decimal(10,2) NOT NULL DEFAULT 1
    CHECK (max_points > 0 AND max_points <> 'NaN'::numeric);

CREATE FUNCTION public.protect_quiz_source_quiz_owner()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.quiz_sources s JOIN public.question_categories c ON c.id=s.category_id
        WHERE s.quiz_id=OLD.id AND c.user_id<>NEW.user_id) THEN
        RAISE EXCEPTION 'The quiz and source categories must belong to the same user'
            USING ERRCODE='23514', CONSTRAINT='quiz_sources_same_user_check';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER quizzes_protect_source_owner
BEFORE UPDATE OF user_id ON public.quizzes FOR EACH ROW
WHEN (OLD.user_id IS DISTINCT FROM NEW.user_id)
EXECUTE FUNCTION public.protect_quiz_source_quiz_owner();

ALTER TABLE public.quizzes DROP CONSTRAINT quizzes_question_count_check;
ALTER TABLE public.quizzes ALTER COLUMN question_count SET DEFAULT 0;
ALTER TABLE public.quizzes ADD CONSTRAINT quizzes_question_count_check CHECK (question_count >= 0);
CREATE FUNCTION public.calculate_quiz_question_count(target_id uuid)
RETURNS integer LANGUAGE sql AS $$
    SELECT ((SELECT count(*) FROM public.quiz_questions WHERE quiz_id=target_id)
        + COALESCE((SELECT sum(question_count) FROM public.quiz_sources WHERE quiz_id=target_id),0))::integer;
$$;
CREATE FUNCTION public.set_quiz_question_count()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.question_count := public.calculate_quiz_question_count(NEW.id);
    RETURN NEW;
END;
$$;
CREATE TRIGGER quizzes_derived_question_count
BEFORE INSERT OR UPDATE OF question_count ON public.quizzes
FOR EACH ROW EXECUTE FUNCTION public.set_quiz_question_count();

-- Both child tables serialize layout edits with attempt creation on the quiz row.
CREATE FUNCTION public.lock_quiz_question_layout()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ids uuid[];
BEGIN
    IF TG_OP='INSERT' THEN ids:=ARRAY[NEW.quiz_id];
    ELSIF TG_OP='DELETE' THEN ids:=ARRAY[OLD.quiz_id];
    ELSE ids:=ARRAY[OLD.quiz_id,NEW.quiz_id]; END IF;
    PERFORM id FROM public.quizzes WHERE id=ANY(ids) ORDER BY id FOR UPDATE;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER quiz_questions_lock_layout BEFORE INSERT OR UPDATE OR DELETE ON public.quiz_questions
FOR EACH ROW EXECUTE FUNCTION public.lock_quiz_question_layout();
CREATE FUNCTION public.refresh_quiz_question_count()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ids uuid[];
BEGIN
    IF TG_OP='INSERT' THEN ids:=ARRAY[NEW.quiz_id];
    ELSIF TG_OP='DELETE' THEN ids:=ARRAY[OLD.quiz_id];
    ELSE ids:=ARRAY[OLD.quiz_id,NEW.quiz_id]; END IF;
    UPDATE public.quizzes SET question_count=public.calculate_quiz_question_count(id), updated_at=now()
        WHERE id=ANY(ids);
    RETURN NULL;
END;
$$;
CREATE TRIGGER quiz_questions_refresh_count AFTER INSERT OR UPDATE OR DELETE ON public.quiz_questions
FOR EACH ROW EXECUTE FUNCTION public.refresh_quiz_question_count();
CREATE TRIGGER quiz_sources_refresh_count AFTER INSERT OR UPDATE OR DELETE ON public.quiz_sources
FOR EACH ROW EXECUTE FUNCTION public.refresh_quiz_question_count();
UPDATE public.quizzes SET question_count=public.calculate_quiz_question_count(id);
COMMENT ON TABLE public.quiz_questions IS 'Fixed questions included in every new attempt; deleting a link preserves the question.';
COMMENT ON TABLE public.quiz_sources IS 'Random question counts from the whole owner category, excluding all fixed questions. NULL means uncategorized.';
COMMENT ON COLUMN public.quizzes.question_count IS 'Read-only derived total: fixed questions plus random source counts. Empty quizzes have zero questions.';

-- Down Migration

DROP TRIGGER quiz_sources_refresh_count ON public.quiz_sources;
DROP TRIGGER quiz_questions_refresh_count ON public.quiz_questions;
DROP TRIGGER quiz_questions_lock_layout ON public.quiz_questions;
DROP FUNCTION public.refresh_quiz_question_count();
DROP FUNCTION public.lock_quiz_question_layout();
DROP TRIGGER quizzes_derived_question_count ON public.quizzes;
DROP FUNCTION public.set_quiz_question_count();
DROP FUNCTION public.calculate_quiz_question_count(uuid);
DROP TRIGGER quizzes_protect_source_owner ON public.quizzes;
DROP FUNCTION public.protect_quiz_source_quiz_owner();
ALTER TABLE public.quiz_sources DROP COLUMN max_points;
ALTER TABLE public.quiz_sources ALTER COLUMN question_count DROP NOT NULL;
ALTER TABLE public.quiz_sources ADD COLUMN question_percentage decimal(5,2);
ALTER TABLE public.quiz_sources ADD CONSTRAINT quiz_sources_percentage_check CHECK (question_percentage > 0 AND question_percentage <= 100);
ALTER TABLE public.quiz_sources ADD CONSTRAINT quiz_sources_one_mode_check CHECK ((question_percentage IS NOT NULL) <> (question_count IS NOT NULL));
-- Rollback restores count-mode allocations, not the original percentages.
UPDATE public.quizzes q SET question_count=COALESCE((SELECT sum(question_count)::integer FROM public.quiz_sources WHERE quiz_id=q.id),GREATEST(q.question_count,1));
ALTER TABLE public.quizzes ALTER COLUMN question_count DROP DEFAULT;
ALTER TABLE public.quizzes DROP CONSTRAINT quizzes_question_count_check;
ALTER TABLE public.quizzes ADD CONSTRAINT quizzes_question_count_check CHECK (question_count > 0);
CREATE OR REPLACE FUNCTION public.assert_quiz_source_allocation(target_quiz_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    quiz_owner uuid;
    required_count integer;
    source_count bigint;
    percentage_count bigint;
    percentage_total numeric;
    count_total bigint;
BEGIN
    SELECT user_id, question_count INTO quiz_owner, required_count
    FROM public.quizzes WHERE id = target_quiz_id;
    IF NOT FOUND THEN RETURN; END IF; -- The quiz itself may have been deleted.
    SELECT count(*), count(question_percentage), sum(question_percentage), sum(question_count)
    INTO source_count, percentage_count, percentage_total, count_total
    FROM public.quiz_sources WHERE quiz_id = target_quiz_id;
    IF source_count = 0 THEN RETURN; END IF; -- A quiz may have no category sources.
    IF EXISTS (
        SELECT 1 FROM public.quiz_sources s JOIN public.question_categories g ON g.id = s.category_id
        WHERE s.quiz_id = target_quiz_id AND g.user_id <> quiz_owner
    ) THEN
        RAISE EXCEPTION 'The quiz and source categories must belong to the same user'
            USING ERRCODE = '23514', CONSTRAINT = 'quiz_sources_same_user_check';
    END IF;
    IF percentage_count <> 0 AND percentage_count <> source_count THEN
        RAISE EXCEPTION 'All quiz sources must use the same allocation mode'
            USING ERRCODE = '23514', CONSTRAINT = 'quiz_sources_allocation_mode_check';
    END IF;
    IF percentage_count > 0 AND percentage_total <> 100 THEN
        RAISE EXCEPTION 'Source percentages must sum to 100'
            USING ERRCODE = '23514', CONSTRAINT = 'quiz_sources_percentage_total_check';
    END IF;
    IF percentage_count = 0 AND count_total <> required_count THEN
        RAISE EXCEPTION 'Source question counts must sum to the quiz question_count'
            USING ERRCODE = '23514', CONSTRAINT = 'quiz_sources_count_total_check';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_quiz_source_allocation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_TABLE_NAME = 'quizzes' THEN
        PERFORM public.assert_quiz_source_allocation(NEW.id);
    ELSE
        IF TG_OP <> 'INSERT' THEN PERFORM public.assert_quiz_source_allocation(OLD.quiz_id); END IF;
        IF TG_OP <> 'DELETE' THEN PERFORM public.assert_quiz_source_allocation(NEW.quiz_id); END IF;
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER quiz_sources_allocation AFTER INSERT OR UPDATE OR DELETE ON public.quiz_sources
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_quiz_source_allocation();
CREATE CONSTRAINT TRIGGER quizzes_source_allocation AFTER UPDATE OF question_count, user_id ON public.quizzes
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_quiz_source_allocation();
COMMENT ON TABLE public.quiz_questions IS 'Candidate pool for quiz attempts.';
COMMENT ON TABLE public.quiz_sources IS 'Category allocations using percentages or exact counts.';
COMMENT ON COLUMN public.quizzes.question_count IS 'Number of questions selected for one attempt.';
