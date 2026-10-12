-- Up Migration

CREATE TABLE public.quiz_requirements (
    quiz_id uuid NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
    video_id uuid NOT NULL REFERENCES public.videos(id) ON DELETE RESTRICT,
    min_watch_percentage decimal(5,2),
    min_watch_seconds integer,
    position integer NOT NULL DEFAULT 0,
    PRIMARY KEY (quiz_id, video_id),
    CONSTRAINT quiz_requirements_one_watch_threshold_check CHECK (
        (min_watch_percentage IS NOT NULL) <> (min_watch_seconds IS NOT NULL)
    ),
    CONSTRAINT quiz_requirements_watch_percentage_check CHECK (
        min_watch_percentage > 0 AND min_watch_percentage <= 100
    ),
    CONSTRAINT quiz_requirements_watch_seconds_positive_check CHECK (
        min_watch_seconds > 0
    )
);

CREATE INDEX quiz_requirements_video_id_idx
ON public.quiz_requirements (video_id);

CREATE FUNCTION public.validate_quiz_requirement_watch_seconds()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    video_duration integer;
BEGIN
    IF NEW.min_watch_seconds IS NULL THEN
        RETURN NEW;
    END IF;

    -- Serialize the duration check with concurrent video duration updates.
    SELECT duration_seconds INTO video_duration
    FROM public.videos
    WHERE id = NEW.video_id
    FOR SHARE;

    -- Missing videos are rejected by the foreign key. A seconds threshold
    -- requires a known duration; percentage thresholds do not.
    IF FOUND AND (video_duration IS NULL OR NEW.min_watch_seconds > video_duration) THEN
        RAISE EXCEPTION 'min_watch_seconds requires a known video duration and cannot exceed it'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'quiz_requirements_watch_seconds_duration_check';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER quiz_requirements_watch_seconds_duration
BEFORE INSERT OR UPDATE OF video_id, min_watch_seconds
ON public.quiz_requirements
FOR EACH ROW
EXECUTE FUNCTION public.validate_quiz_requirement_watch_seconds();

CREATE FUNCTION public.validate_video_duration_quiz_requirements()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    -- Preserve the invariant if a linked video's duration changes later.
    IF EXISTS (
        SELECT 1
        FROM public.quiz_requirements
        WHERE video_id = NEW.id
          AND min_watch_seconds IS NOT NULL
          AND (NEW.duration_seconds IS NULL OR min_watch_seconds > NEW.duration_seconds)
    ) THEN
        RAISE EXCEPTION 'Video duration cannot invalidate existing quiz requirements'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'quiz_requirements_watch_seconds_duration_check';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER videos_quiz_requirements_duration
BEFORE UPDATE OF duration_seconds
ON public.videos
FOR EACH ROW
WHEN (OLD.duration_seconds IS DISTINCT FROM NEW.duration_seconds)
EXECUTE FUNCTION public.validate_video_duration_quiz_requirements();

COMMENT ON TABLE public.quiz_requirements IS
    'Required videos for each quiz, with exactly one watch threshold per video.';

-- Down Migration

DROP TRIGGER videos_quiz_requirements_duration ON public.videos;
DROP TABLE public.quiz_requirements;
DROP FUNCTION public.validate_quiz_requirement_watch_seconds();
DROP FUNCTION public.validate_video_duration_quiz_requirements();
