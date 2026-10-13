-- Up Migration

-- Collections were publicly listed before visibility was introduced.
ALTER TABLE public.collections
    ADD COLUMN visibility text NOT NULL DEFAULT 'public'
        CONSTRAINT collections_visibility_check CHECK (visibility IN ('private', 'public')),
    ADD COLUMN subheading varchar(255);

-- Down Migration

ALTER TABLE public.collections
    DROP COLUMN subheading,
    DROP COLUMN visibility;
