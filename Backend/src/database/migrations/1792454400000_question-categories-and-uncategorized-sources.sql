-- Up Migration

-- Collapse old memberships deterministically: first name, then ID.
ALTER TABLE public.question_groups RENAME TO question_categories;
ALTER TABLE public.question_categories RENAME CONSTRAINT question_groups_pkey TO question_categories_pkey;
ALTER TABLE public.question_categories RENAME CONSTRAINT question_groups_user_id_fkey TO question_categories_user_id_fkey;
ALTER TABLE public.question_categories RENAME CONSTRAINT question_groups_user_name_key TO question_categories_user_name_key;
ALTER TABLE public.questions ADD COLUMN category_id uuid REFERENCES public.question_categories(id) ON DELETE SET NULL;
CREATE INDEX questions_category_id_idx ON public.questions(category_id);

CREATE FUNCTION public.validate_question_category_owner()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE category_owner uuid;
BEGIN
    IF NEW.category_id IS NULL THEN RETURN NEW; END IF;
    SELECT user_id INTO category_owner FROM public.question_categories WHERE id=NEW.category_id FOR SHARE;
    IF category_owner <> NEW.user_id THEN
        RAISE EXCEPTION 'The question and category must belong to the same user'
            USING ERRCODE='23514', CONSTRAINT='questions_category_same_user_check';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER questions_category_same_user
BEFORE INSERT OR UPDATE OF category_id, user_id ON public.questions
FOR EACH ROW EXECUTE FUNCTION public.validate_question_category_owner();

UPDATE public.questions q SET category_id=chosen.group_id
FROM (
    SELECT DISTINCT ON (gi.question_id) gi.question_id, gi.group_id
    FROM public.question_group_items gi JOIN public.question_categories c ON c.id=gi.group_id
    ORDER BY gi.question_id, c.name, c.id
) chosen WHERE q.id=chosen.question_id;
DROP TABLE public.question_group_items;
DROP FUNCTION public.validate_question_group_item_owner();

CREATE FUNCTION public.protect_question_category_owner()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.questions WHERE category_id=OLD.id) THEN
        RAISE EXCEPTION 'Cannot change the owner of a category containing questions'
            USING ERRCODE='23514', CONSTRAINT='questions_category_same_user_check';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER question_categories_protect_question_owner
BEFORE UPDATE OF user_id ON public.question_categories
FOR EACH ROW WHEN (OLD.user_id IS DISTINCT FROM NEW.user_id)
EXECUTE FUNCTION public.protect_question_category_owner();

ALTER TABLE public.quiz_sources DROP CONSTRAINT quiz_sources_pkey;
ALTER TABLE public.quiz_sources RENAME COLUMN group_id TO category_id;
ALTER TABLE public.quiz_sources ALTER COLUMN category_id DROP NOT NULL;
ALTER TABLE public.quiz_sources ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.quiz_sources ADD PRIMARY KEY(id);
ALTER TABLE public.quiz_sources RENAME CONSTRAINT quiz_sources_group_id_fkey TO quiz_sources_category_id_fkey;
ALTER INDEX public.quiz_sources_group_id_idx RENAME TO quiz_sources_category_id_idx;
CREATE UNIQUE INDEX quiz_sources_quiz_category_unique ON public.quiz_sources(quiz_id,category_id) WHERE category_id IS NOT NULL;
CREATE UNIQUE INDEX quiz_sources_quiz_uncategorized_unique ON public.quiz_sources(quiz_id) WHERE category_id IS NULL;
DROP TRIGGER question_groups_protect_source_owner ON public.question_categories;
DROP FUNCTION public.protect_quiz_source_group_owner();
CREATE OR REPLACE FUNCTION public.lock_quiz_source_parents()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    affected_ids uuid[];
    quiz_owner uuid;
    category_owner uuid;
BEGIN
    IF TG_OP = 'INSERT' THEN affected_ids := ARRAY[NEW.quiz_id];
    ELSIF TG_OP = 'DELETE' THEN affected_ids := ARRAY[OLD.quiz_id];
    ELSE affected_ids := ARRAY[OLD.quiz_id, NEW.quiz_id];
    END IF;
    -- Serialize changes to each distribution, including cascading deletes.
    PERFORM id FROM public.quizzes WHERE id = ANY(affected_ids) ORDER BY id FOR UPDATE;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    SELECT user_id INTO quiz_owner FROM public.quizzes WHERE id = NEW.quiz_id;
    SELECT user_id INTO category_owner FROM public.question_categories WHERE id = NEW.category_id FOR SHARE;
    IF quiz_owner <> category_owner THEN
        RAISE EXCEPTION 'The quiz and source category must belong to the same user'
            USING ERRCODE = '23514', CONSTRAINT = 'quiz_sources_same_user_check';
    END IF;
    RETURN NEW;
END;
$$;

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

CREATE OR REPLACE FUNCTION public.protect_quiz_source_category_owner()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.quiz_sources WHERE category_id = OLD.id) THEN
        RAISE EXCEPTION 'Cannot change the owner of a category used as a quiz source'
            USING ERRCODE = '23514', CONSTRAINT = 'quiz_sources_same_user_check';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER question_categories_protect_source_owner
BEFORE UPDATE OF user_id ON public.question_categories
FOR EACH ROW WHEN (OLD.user_id IS DISTINCT FROM NEW.user_id)
EXECUTE FUNCTION public.protect_quiz_source_category_owner();
COMMENT ON TABLE public.quiz_sources IS 'Category allocations; a NULL category selects only uncategorized quiz candidates.';
COMMENT ON COLUMN public.questions.category_id IS 'At most one category, belonging to the same owner. NULL means uncategorized.';

-- Preserve permission IDs and every existing role grant/deny.
UPDATE public.permissions SET key=replace(key,'question_groups.','question_categories.'),
    resource_type='question_category', group_name='Question categories',
    description=replace(replace(description,'groups','categories'),'group','category')
WHERE key LIKE 'question_groups.%';
UPDATE public.permissions SET description=replace(description,'group memberships','category')
WHERE key IN ('questions.update_own','questions.update_any');

-- Down Migration

-- Removed multiple memberships cannot be recovered. Restore the currently assigned category as one membership.
-- Remove uncategorized sources explicitly before rollback; do not silently discard their quota.
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM public.quiz_sources WHERE category_id IS NULL) THEN
        RAISE EXCEPTION 'Remove uncategorized quiz sources before rolling back categories';
    END IF;
END $$;
DROP TRIGGER question_categories_protect_source_owner ON public.question_categories;
DROP FUNCTION public.protect_quiz_source_category_owner();
DROP TRIGGER question_categories_protect_question_owner ON public.question_categories;
DROP FUNCTION public.protect_question_category_owner();
DROP TRIGGER questions_category_same_user ON public.questions;
DROP FUNCTION public.validate_question_category_owner();
ALTER TABLE public.question_categories RENAME TO question_groups;
ALTER TABLE public.question_groups RENAME CONSTRAINT question_categories_pkey TO question_groups_pkey;
ALTER TABLE public.question_groups RENAME CONSTRAINT question_categories_user_id_fkey TO question_groups_user_id_fkey;
ALTER TABLE public.question_groups RENAME CONSTRAINT question_categories_user_name_key TO question_groups_user_name_key;
CREATE TABLE public.question_group_items (
    group_id uuid NOT NULL REFERENCES public.question_groups(id) ON DELETE CASCADE,
    question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, question_id)
);

CREATE INDEX question_group_items_question_id_idx
ON public.question_group_items (question_id);

CREATE FUNCTION public.validate_question_group_item_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    group_owner uuid;
    question_owner uuid;
BEGIN
    -- Lock the referenced records while checking their current owners.
    SELECT user_id INTO group_owner
    FROM public.question_groups
    WHERE id = NEW.group_id
    FOR SHARE;

    SELECT user_id INTO question_owner
    FROM public.questions
    WHERE id = NEW.question_id
    FOR SHARE;

    -- Missing records are rejected by the foreign keys. For existing records,
    -- membership requires a matching owner on insertion and reassignment.
    IF group_owner <> question_owner THEN
        RAISE EXCEPTION 'The question and its group must belong to the same user'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'question_group_items_same_user_check';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER question_group_items_same_user
BEFORE INSERT OR UPDATE OF group_id, question_id
ON public.question_group_items
FOR EACH ROW
EXECUTE FUNCTION public.validate_question_group_item_owner();


INSERT INTO public.question_group_items(group_id,question_id)
SELECT category_id,id FROM public.questions WHERE category_id IS NOT NULL;
ALTER TABLE public.questions DROP COLUMN category_id;
DROP INDEX public.quiz_sources_quiz_category_unique;
DROP INDEX public.quiz_sources_quiz_uncategorized_unique;
ALTER TABLE public.quiz_sources DROP CONSTRAINT quiz_sources_pkey;
ALTER TABLE public.quiz_sources DROP COLUMN id;
ALTER TABLE public.quiz_sources RENAME COLUMN category_id TO group_id;
ALTER TABLE public.quiz_sources ALTER COLUMN group_id SET NOT NULL;
ALTER TABLE public.quiz_sources ADD PRIMARY KEY(quiz_id,group_id);
ALTER TABLE public.quiz_sources RENAME CONSTRAINT quiz_sources_category_id_fkey TO quiz_sources_group_id_fkey;
ALTER INDEX public.quiz_sources_category_id_idx RENAME TO quiz_sources_group_id_idx;
CREATE OR REPLACE FUNCTION public.lock_quiz_source_parents()
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

CREATE OR REPLACE FUNCTION public.protect_quiz_source_group_owner()
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
UPDATE public.permissions SET key=replace(key,'question_categories.','question_groups.'),
    resource_type='question_group', group_name='Question groups',
    description=replace(replace(description,'categories','groups'),'category','group')
WHERE key LIKE 'question_categories.%';
