-- Up Migration

CREATE TABLE public.quiz_sources (
    quiz_id uuid NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
    group_id uuid NOT NULL REFERENCES public.question_groups(id) ON DELETE CASCADE,
    position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
    question_percentage decimal(5,2),
    question_count integer,
    PRIMARY KEY (quiz_id, group_id),
    CONSTRAINT quiz_sources_one_mode_check CHECK (
        (question_percentage IS NOT NULL) <> (question_count IS NOT NULL)
    ),
    CONSTRAINT quiz_sources_percentage_check CHECK (question_percentage > 0 AND question_percentage <= 100),
    CONSTRAINT quiz_sources_count_check CHECK (question_count > 0)
);

CREATE INDEX quiz_sources_group_id_idx ON public.quiz_sources (group_id);

CREATE FUNCTION public.lock_quiz_source_parents()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    affected_ids uuid[];
    quiz_owner uuid;
    group_owner uuid;
BEGIN
    IF TG_OP = 'INSERT' THEN affected_ids := ARRAY[NEW.quiz_id];
    ELSIF TG_OP = 'DELETE' THEN affected_ids := ARRAY[OLD.quiz_id];
    ELSE affected_ids := ARRAY[OLD.quiz_id, NEW.quiz_id];
    END IF;
    -- Serialize changes to each distribution, including cascading deletes.
    PERFORM id FROM public.quizzes WHERE id = ANY(affected_ids) ORDER BY id FOR UPDATE;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    SELECT user_id INTO quiz_owner FROM public.quizzes WHERE id = NEW.quiz_id;
    SELECT user_id INTO group_owner FROM public.question_groups WHERE id = NEW.group_id FOR SHARE;
    IF quiz_owner <> group_owner THEN
        RAISE EXCEPTION 'The quiz and source group must belong to the same user'
            USING ERRCODE = '23514', CONSTRAINT = 'quiz_sources_same_user_check';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER quiz_sources_lock_parents
BEFORE INSERT OR UPDATE OR DELETE ON public.quiz_sources
FOR EACH ROW EXECUTE FUNCTION public.lock_quiz_source_parents();

CREATE FUNCTION public.assert_quiz_source_allocation(target_quiz_id uuid)
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
    IF source_count = 0 THEN RETURN; END IF; -- A quiz may have no group sources.
    IF EXISTS (
        SELECT 1 FROM public.quiz_sources s JOIN public.question_groups g ON g.id = s.group_id
        WHERE s.quiz_id = target_quiz_id AND g.user_id <> quiz_owner
    ) THEN
        RAISE EXCEPTION 'The quiz and source groups must belong to the same user'
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

CREATE FUNCTION public.validate_quiz_source_allocation()
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

-- Validate the final transaction state so a distribution can be replaced atomically.
CREATE CONSTRAINT TRIGGER quiz_sources_allocation
AFTER INSERT OR UPDATE OR DELETE ON public.quiz_sources
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.validate_quiz_source_allocation();

CREATE CONSTRAINT TRIGGER quizzes_source_allocation
AFTER UPDATE OF question_count, user_id ON public.quizzes
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.validate_quiz_source_allocation();

CREATE FUNCTION public.protect_quiz_source_group_owner()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.quiz_sources WHERE group_id = OLD.id) THEN
        RAISE EXCEPTION 'Cannot change the owner of a group used as a quiz source'
            USING ERRCODE = '23514', CONSTRAINT = 'quiz_sources_same_user_check';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER question_groups_protect_source_owner
BEFORE UPDATE OF user_id ON public.question_groups
FOR EACH ROW WHEN (OLD.user_id IS DISTINCT FROM NEW.user_id)
EXECUTE FUNCTION public.protect_quiz_source_group_owner();

COMMENT ON TABLE public.quiz_sources IS
    'Group sources for question selection. Nonempty allocations must be complete at commit; empty source sets are allowed.';

-- Down Migration

DROP TRIGGER question_groups_protect_source_owner ON public.question_groups;
DROP TRIGGER quizzes_source_allocation ON public.quizzes;
DROP TABLE public.quiz_sources;
DROP FUNCTION public.protect_quiz_source_group_owner();
DROP FUNCTION public.validate_quiz_source_allocation();
DROP FUNCTION public.assert_quiz_source_allocation(uuid);
DROP FUNCTION public.lock_quiz_source_parents();
