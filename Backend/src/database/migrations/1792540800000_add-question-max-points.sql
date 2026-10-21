-- Up Migration

ALTER TABLE public.questions
    ADD COLUMN max_points decimal(10,2) NOT NULL DEFAULT 1
    CONSTRAINT questions_max_points_check CHECK (max_points > 0 AND max_points <> 'NaN'::numeric);

COMMENT ON COLUMN public.questions.max_points IS
    'Default points copied when adding a fixed quiz question without an explicit points override.';

-- Down Migration

ALTER TABLE public.questions DROP COLUMN max_points;
