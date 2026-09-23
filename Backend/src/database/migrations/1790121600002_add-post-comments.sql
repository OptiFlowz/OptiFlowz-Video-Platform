-- Up Migration

CREATE TABLE public.post_comments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    parent_id uuid REFERENCES public.post_comments(id) ON DELETE CASCADE,
    content text,
    is_deleted boolean NOT NULL DEFAULT false,
    like_count integer NOT NULL DEFAULT 0,
    dislike_count integer NOT NULL DEFAULT 0,
    reply_count integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_post_comments_parent_created ON public.post_comments (parent_id, created_at);
CREATE INDEX idx_post_comments_post_created ON public.post_comments (post_id, created_at DESC)
    WHERE parent_id IS NULL;
CREATE INDEX idx_post_comments_post_not_deleted ON public.post_comments (post_id)
    WHERE is_deleted = false;
CREATE INDEX idx_post_comments_user_id ON public.post_comments (user_id);

CREATE TABLE public.post_comment_reactions (
    comment_id uuid NOT NULL REFERENCES public.post_comments(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    reaction smallint NOT NULL CHECK (reaction IN (-1, 1)),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (comment_id, user_id)
);

CREATE INDEX idx_post_comment_reactions_user_id ON public.post_comment_reactions (user_id);

-- Separate functions keep the existing video-comment triggers unchanged.
CREATE FUNCTION public.update_post_comment_reply_count() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF OLD.parent_id IS NOT DISTINCT FROM NEW.parent_id
           AND OLD.is_deleted = NEW.is_deleted THEN
            RETURN NEW;
        END IF;
    END IF;

    IF TG_OP IN ('DELETE', 'UPDATE') THEN
        IF OLD.parent_id IS NOT NULL AND NOT OLD.is_deleted THEN
            UPDATE public.post_comments
            SET reply_count = GREATEST(reply_count - 1, 0)
            WHERE id = OLD.parent_id;
        END IF;
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        IF NEW.parent_id IS NOT NULL AND NOT NEW.is_deleted THEN
            UPDATE public.post_comments SET reply_count = reply_count + 1
            WHERE id = NEW.parent_id;
        END IF;
    END IF;
    RETURN NULL;
END;
$$;

CREATE FUNCTION public.set_post_comment_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_post_comments_reply_count_del AFTER DELETE ON public.post_comments
FOR EACH ROW EXECUTE FUNCTION public.update_post_comment_reply_count();
CREATE TRIGGER trg_post_comments_reply_count_ins AFTER INSERT ON public.post_comments
FOR EACH ROW EXECUTE FUNCTION public.update_post_comment_reply_count();
CREATE TRIGGER trg_post_comments_reply_count_upd AFTER UPDATE OF parent_id, is_deleted ON public.post_comments
FOR EACH ROW EXECUTE FUNCTION public.update_post_comment_reply_count();
CREATE TRIGGER trg_post_comments_updated_at BEFORE UPDATE ON public.post_comments
FOR EACH ROW EXECUTE FUNCTION public.set_post_comment_updated_at();

-- Down Migration

DROP TABLE public.post_comment_reactions;
DROP TABLE public.post_comments;
DROP FUNCTION public.update_post_comment_reply_count();
DROP FUNCTION public.set_post_comment_updated_at();
