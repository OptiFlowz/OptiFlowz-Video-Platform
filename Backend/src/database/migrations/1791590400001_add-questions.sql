-- Up Migration

CREATE TYPE public.question_type AS ENUM (
    'single_choice',
    'multiple_choice',
    'matching'
);

CREATE TABLE public.questions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    type public.question_type NOT NULL,
    content text NOT NULL,
    explanation text
);

CREATE TABLE public.question_options (
    question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
    option_no smallint NOT NULL CHECK (option_no > 0),
    content text NOT NULL,
    is_correct boolean NOT NULL DEFAULT false,
    position integer NOT NULL CHECK (position > 0),
    PRIMARY KEY (question_id, option_no)
);

CREATE TABLE public.question_matching_options (
    question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
    option_no smallint NOT NULL CHECK (option_no > 0),
    content text NOT NULL,
    position integer NOT NULL CHECK (position > 0),
    PRIMARY KEY (question_id, option_no)
);

CREATE TABLE public.question_matching_items (
    question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
    item_no smallint NOT NULL CHECK (item_no > 0),
    content text NOT NULL,
    correct_option_no smallint NOT NULL CHECK (correct_option_no > 0),
    position integer NOT NULL CHECK (position > 0),
    PRIMARY KEY (question_id, item_no),
    CONSTRAINT question_matching_items_correct_option_fkey
        FOREIGN KEY (question_id, correct_option_no)
        REFERENCES public.question_matching_options (question_id, option_no)
        ON DELETE NO ACTION
);

CREATE INDEX questions_user_id_idx
ON public.questions (user_id);

CREATE INDEX question_options_question_position_idx
ON public.question_options (question_id, position, option_no);

CREATE INDEX question_matching_options_question_position_idx
ON public.question_matching_options (question_id, position, option_no);

CREATE INDEX question_matching_items_question_position_idx
ON public.question_matching_items (question_id, position, item_no);

CREATE INDEX question_matching_items_correct_option_idx
ON public.question_matching_items (question_id, correct_option_no);

COMMENT ON COLUMN public.question_options.option_no IS
    'Stable option identifier within a question; reordering changes position only.';
COMMENT ON COLUMN public.question_matching_options.option_no IS
    'Stable matching option identifier within a question; may answer multiple items.';
COMMENT ON COLUMN public.question_matching_items.item_no IS
    'Stable matching item identifier within a question; reordering changes position only.';
COMMENT ON CONSTRAINT question_matching_items_correct_option_fkey
ON public.question_matching_items IS
    'Blocks deletion of a referenced option, while allowing all children to cascade when the question is deleted.';
COMMENT ON TABLE public.questions IS
    'Question drafts are allowed. The application validates child table types and correct answer counts at activation.';

-- Down Migration

DROP TABLE public.question_matching_items;
DROP TABLE public.question_matching_options;
DROP TABLE public.question_options;
DROP TABLE public.questions;
DROP TYPE public.question_type;
