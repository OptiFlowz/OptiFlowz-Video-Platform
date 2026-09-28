-- Up Migration

ALTER TABLE public.live_streams
    ADD COLUMN user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
    ADD COLUMN title text,
    ADD COLUMN description text,
    ADD COLUMN thumbnail_url text,
    ADD COLUMN visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'unlisted', 'private')),
    ADD COLUMN playback_policy text NOT NULL DEFAULT 'signed' CHECK (playback_policy IN ('public', 'signed')),
    ADD COLUMN mux_active_asset_id text,
    ADD COLUMN mux_session_ended_at timestamptz,
    ADD COLUMN mux_deleted_asset_ids text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.videos
    ADD COLUMN live_stream_id uuid REFERENCES public.live_streams(id) ON DELETE CASCADE,
    ADD COLUMN mux_asset_event_at timestamptz,
    ADD COLUMN mux_recording_started_at timestamptz,
    ADD COLUMN mux_recording_completed_at timestamptz;

-- Preserve existing videos, their IDs, metadata and interactions.
UPDATE public.live_streams ls SET
    user_id = v.uploaded_by, title = COALESCE(v.title, 'Live stream'),
    description = v.description, thumbnail_url = v.thumbnail_url,
    visibility = v.visibility, playback_policy = v.playback_policy,
    mux_active_asset_id = v.mux_asset_id,
    mux_session_ended_at = COALESCE(ls.completed_at, ls.ended_at)
FROM public.videos v WHERE v.id = ls.video_id;

UPDATE public.videos v SET
    live_stream_id = ls.id, mux_asset_event_at = ls.mux_asset_event_at,
    mux_recording_started_at = COALESCE(ls.started_at, ls.connected_at),
    mux_recording_completed_at = ls.completed_at
FROM public.live_streams ls WHERE ls.video_id = v.id;

ALTER TABLE public.live_streams
    ALTER COLUMN user_id SET NOT NULL,
    ALTER COLUMN title SET NOT NULL,
    DROP COLUMN video_id,
    DROP COLUMN mux_asset_event_at;

CREATE INDEX videos_live_stream_id_idx ON public.videos(live_stream_id);
CREATE UNIQUE INDEX videos_live_stream_asset_key ON public.videos(live_stream_id, mux_asset_id)
    WHERE live_stream_id IS NOT NULL AND mux_asset_id IS NOT NULL;

-- Down Migration

-- Multiple recordings cannot be represented by the old one-to-one model.
-- Refuse an automatic downgrade rather than silently losing recording links.
DO $$ BEGIN
    RAISE EXCEPTION 'This data migration requires a manual downgrade to preserve all live stream recordings';
END $$;
