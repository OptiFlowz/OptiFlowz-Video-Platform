-- Up Migration

-- Live streams use the video's visibility, including unlisted content.
ALTER TABLE public.videos DROP CONSTRAINT IF EXISTS visibility;
ALTER TABLE public.videos ADD CONSTRAINT visibility
    CHECK (visibility IN ('public', 'unlisted', 'private')) NOT VALID;

CREATE TABLE IF NOT EXISTS public.live_streams
(
    id uuid NOT NULL DEFAULT uuid_generate_v4(),

    video_id uuid NOT NULL,

    -- Application lifecycle
    status text NOT NULL DEFAULT 'scheduled',

    -- Mux Live Stream status
    mux_status text NOT NULL DEFAULT 'idle',

    dvr_enabled boolean NOT NULL DEFAULT false,

    scheduled_at timestamp with time zone,

    -- Application event lifecycle
    started_at timestamp with time zone,
    ended_at timestamp with time zone,

    -- Mux / encoder lifecycle
    connected_at timestamp with time zone,
    disconnected_at timestamp with time zone,
    completed_at timestamp with time zone,

    -- Mux Live Stream
    mux_live_stream_id text NOT NULL,
    mux_live_playback_id text NOT NULL,

    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),

    CONSTRAINT live_streams_pkey
        PRIMARY KEY (id),

    CONSTRAINT live_streams_video_id_fkey
        FOREIGN KEY (video_id)
        REFERENCES public.videos(id)
        ON DELETE CASCADE,

    CONSTRAINT live_streams_video_id_key
        UNIQUE (video_id),

    CONSTRAINT live_streams_mux_status_check
        CHECK (
            mux_status IN (
                'idle',
                'active',
                'disabled'
            )
        )
);

-- Down Migration

DROP TABLE public.live_streams;

-- Preserve existing rows when restoring the previous visibility constraint.
ALTER TABLE public.videos DROP CONSTRAINT visibility;
ALTER TABLE public.videos ADD CONSTRAINT visibility
    CHECK (visibility IN ('public', 'private')) NOT VALID;
