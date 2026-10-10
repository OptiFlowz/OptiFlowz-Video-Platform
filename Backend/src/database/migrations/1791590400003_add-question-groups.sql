-- Up Migration

CREATE TABLE public.question_groups (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    name varchar(255) NOT NULL,
    description text,
    CONSTRAINT question_groups_user_name_key UNIQUE (user_id, name)
);

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

COMMENT ON TABLE public.question_group_items IS
    'Many-to-many memberships. Deleting a group removes its memberships, preserving the questions.';

-- Down Migration

DROP TABLE public.question_group_items;
DROP TABLE public.question_groups;
DROP FUNCTION public.validate_question_group_item_owner();
