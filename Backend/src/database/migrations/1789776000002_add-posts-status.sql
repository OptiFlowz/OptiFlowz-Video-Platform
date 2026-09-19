-- Up Migration

ALTER TABLE public.posts
    ADD COLUMN status text NOT NULL DEFAULT 'private'
        CHECK (status IN ('private', 'public'));

-- Down Migration

ALTER TABLE public.posts
    DROP COLUMN status;
