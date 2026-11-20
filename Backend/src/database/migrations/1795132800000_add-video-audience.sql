-- Up Migration

ALTER TABLE public.videos
    ADD COLUMN audience_mode text NOT NULL DEFAULT 'everyone'
        CHECK (audience_mode IN ('everyone', 'selected_roles'));

CREATE TABLE public.video_allowed_roles (
    video_id uuid NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
    role_id bigint NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
    PRIMARY KEY (video_id, role_id)
);

CREATE INDEX video_allowed_roles_role_id_idx ON public.video_allowed_roles (role_id);

-- Down Migration

DROP TABLE public.video_allowed_roles;
ALTER TABLE public.videos DROP COLUMN audience_mode;
