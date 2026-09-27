-- Up Migration

ALTER TABLE public.videos
    ADD COLUMN kind text NOT NULL DEFAULT 'upload'
        CONSTRAINT videos_kind_check CHECK (kind IN ('upload', 'live')),
    ADD CONSTRAINT videos_id_kind_unique UNIQUE (id, kind);

CREATE TABLE public.video_livestreams (
    video_id uuid PRIMARY KEY,
    -- A composite FK enforces the live parent type, including later kind changes.
    video_kind text GENERATED ALWAYS AS ('live'::text) STORED,
    mode text NOT NULL CHECK (mode IN ('standard', 'dvr')),
    status text NOT NULL DEFAULT 'scheduled' CHECK (status IN (
        'scheduled', 'live', 'reconnecting', 'ending', 'ended', 'cancelled', 'errored'
    )),
    mux_live_stream_id text UNIQUE,
    mux_live_playback_id text UNIQUE,
    scheduled_start_at timestamptz,
    started_at timestamptz,
    ended_at timestamptz,
    max_duration_seconds integer NOT NULL CHECK (max_duration_seconds > 0),
    stop_at timestamptz,
    recording_finalized_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT video_livestreams_video_fk FOREIGN KEY (video_id, video_kind)
        REFERENCES public.videos (id, kind) ON DELETE CASCADE,
    CONSTRAINT video_livestreams_dvr_duration_check
        CHECK (mode <> 'dvr' OR max_duration_seconds < 14400),
    CONSTRAINT video_livestreams_end_time_check
        CHECK (ended_at IS NULL OR (started_at IS NOT NULL AND ended_at >= started_at)),
    CONSTRAINT video_livestreams_stop_time_check
        CHECK (stop_at IS NULL OR (started_at IS NOT NULL AND stop_at > started_at))
);

CREATE INDEX video_livestreams_schedule_idx
    ON public.video_livestreams (scheduled_start_at, video_id)
    WHERE status = 'scheduled';
CREATE INDEX video_livestreams_stop_idx
    ON public.video_livestreams (stop_at, video_id)
    WHERE status IN ('live', 'reconnecting', 'ending');

COMMENT ON COLUMN public.videos.kind IS
    'Content origin. Finished livestream recordings remain kind=live.';
COMMENT ON COLUMN public.video_livestreams.max_duration_seconds IS
    'Configured limit; Mux and a backend worker must enforce it, allowing for reconnect time.';
COMMENT ON TABLE public.video_livestreams IS
    'One broadcast per video. Create the live video and this row in the same transaction.';

-- Down Migration

-- Do not silently turn live content into uploads or discard broadcast metadata.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.videos WHERE kind = 'live') THEN
        RAISE EXCEPTION 'Cannot roll back livestream schema while live videos exist';
    END IF;
END;
$$;

DROP TABLE public.video_livestreams;
ALTER TABLE public.videos DROP CONSTRAINT videos_id_kind_unique, DROP COLUMN kind;
