-- Up Migration

CREATE TABLE public.posts (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    title text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX posts_user_created_at_idx
ON public.posts (user_id, created_at DESC);

CREATE INDEX posts_created_at_idx
ON public.posts (created_at DESC);

CREATE TABLE public.post_blocks (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
    type text NOT NULL
        CHECK (type IN ('text', 'image', 'video', 'poll', 'questioner')),
    position integer NOT NULL CHECK (position >= 0),
    content jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(content) = 'object'),

    CONSTRAINT post_blocks_post_position_unique UNIQUE (post_id, position)
);

CREATE TABLE public.poll_options (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    block_id uuid NOT NULL REFERENCES public.post_blocks(id) ON DELETE CASCADE,
    text text NOT NULL,
    image_url text
);

CREATE INDEX poll_options_block_id_idx
ON public.poll_options (block_id);

CREATE TABLE public.poll_votes (
    option_id uuid NOT NULL REFERENCES public.poll_options(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (option_id, user_id)
);

CREATE INDEX poll_votes_user_id_idx
ON public.poll_votes (user_id);

CREATE TABLE public.questioner_options (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    block_id uuid NOT NULL REFERENCES public.post_blocks(id) ON DELETE CASCADE,
    text text NOT NULL,
    image_url text,
    is_correct boolean NOT NULL DEFAULT false
);

CREATE INDEX questioner_options_block_id_idx
ON public.questioner_options (block_id);

CREATE TABLE public.questioner_answers (
    option_id uuid NOT NULL REFERENCES public.questioner_options(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (option_id, user_id)
);

CREATE INDEX questioner_answers_user_id_idx
ON public.questioner_answers (user_id);

-- Down Migration

DROP TABLE public.questioner_answers;
DROP TABLE public.questioner_options;
DROP TABLE public.poll_votes;
DROP TABLE public.poll_options;
DROP TABLE public.post_blocks;
DROP TABLE public.posts;
