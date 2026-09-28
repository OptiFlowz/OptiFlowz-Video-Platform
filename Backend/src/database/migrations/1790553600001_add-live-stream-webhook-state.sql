-- Up Migration

ALTER TABLE public.live_streams
    ADD COLUMN mux_event_at timestamptz,
    ADD COLUMN mux_asset_event_at timestamptz;

CREATE UNIQUE INDEX live_streams_mux_live_stream_id_key
    ON public.live_streams (mux_live_stream_id);

-- Down Migration

DROP INDEX public.live_streams_mux_live_stream_id_key;
ALTER TABLE public.live_streams
    DROP COLUMN mux_asset_event_at,
    DROP COLUMN mux_event_at;
