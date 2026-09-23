-- Up Migration

CREATE TABLE public.post_reactions (
    post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    reaction smallint NOT NULL CHECK (reaction IN (-1, 1)),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (post_id, user_id)
);

CREATE INDEX post_reactions_user_id_idx ON public.post_reactions (user_id);

INSERT INTO permissions (key, description, group_name, resource_type, risk_level)
VALUES ('posts.react', 'Like and dislike posts', 'Posts', 'post', 'normal')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT r.id, p.id, 'allow'
FROM roles r CROSS JOIN permissions p
WHERE p.key = 'posts.react' AND r.name IN ('Viewer', 'Administrator')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Down Migration

DELETE FROM permissions WHERE key = 'posts.react';
DROP TABLE public.post_reactions;
