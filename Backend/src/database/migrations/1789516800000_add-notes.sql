-- Up Migration

CREATE TABLE public.notes (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    video_id uuid NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
    title text NOT NULL,
    text text NOT NULL,
    timestamp double precision NOT NULL
        CHECK (timestamp >= 0 AND timestamp < 'Infinity'::double precision),
    color text
);

CREATE INDEX notes_user_video_timestamp_idx
ON public.notes (user_id, video_id, timestamp);

CREATE INDEX notes_video_id_idx
ON public.notes (video_id);

COMMENT ON COLUMN public.notes.timestamp IS
    'Playback position in seconds, including fractional seconds.';

-- Down Migration

DROP TABLE public.notes;
