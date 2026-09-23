-- Up Migration

ALTER TABLE public.posts
    ADD COLUMN like_count integer NOT NULL DEFAULT 0 CHECK (like_count >= 0),
    ADD COLUMN dislike_count integer NOT NULL DEFAULT 0 CHECK (dislike_count >= 0);

-- Backfill reactions saved before the counters were added.
UPDATE public.posts p
SET like_count = counts.likes,
    dislike_count = counts.dislikes
FROM (
    SELECT post_id,
        (COUNT(*) FILTER (WHERE reaction = 1))::integer AS likes,
        (COUNT(*) FILTER (WHERE reaction = -1))::integer AS dislikes
    FROM public.post_reactions
    GROUP BY post_id
) counts
WHERE p.id = counts.post_id;

-- Down Migration

ALTER TABLE public.posts DROP COLUMN dislike_count, DROP COLUMN like_count;
