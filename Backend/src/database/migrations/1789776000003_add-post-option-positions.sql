-- Up Migration

ALTER TABLE public.poll_options ADD COLUMN position integer;
ALTER TABLE public.questioner_options ADD COLUMN position integer;

-- Preserve the UUID ordering used by existing read endpoints.
WITH ordered AS (
    SELECT id, (row_number() OVER (PARTITION BY block_id ORDER BY id) - 1)::integer AS position
    FROM public.poll_options
)
UPDATE public.poll_options o SET position = ordered.position
FROM ordered WHERE o.id = ordered.id;

WITH ordered AS (
    SELECT id, (row_number() OVER (PARTITION BY block_id ORDER BY id) - 1)::integer AS position
    FROM public.questioner_options
)
UPDATE public.questioner_options o SET position = ordered.position
FROM ordered WHERE o.id = ordered.id;

ALTER TABLE public.poll_options
    ALTER COLUMN position SET NOT NULL,
    ADD CONSTRAINT poll_options_position_check CHECK (position >= 0),
    ADD CONSTRAINT poll_options_block_position_unique UNIQUE (block_id, position);

ALTER TABLE public.questioner_options
    ALTER COLUMN position SET NOT NULL,
    ADD CONSTRAINT questioner_options_position_check CHECK (position >= 0),
    ADD CONSTRAINT questioner_options_block_position_unique UNIQUE (block_id, position);

-- Down Migration

ALTER TABLE public.questioner_options DROP COLUMN position;
ALTER TABLE public.poll_options DROP COLUMN position;
