-- Up Migration

-- Older webhook versions left completed recordings unpublished.
UPDATE public.videos
SET published_at = now(), updated_at = now()
WHERE live_stream_id IS NOT NULL
  AND mux_status = 'ready'
  AND mux_recording_completed_at IS NOT NULL
  AND published_at IS NULL;

-- Down Migration

-- Publication dates cannot be distinguished from later user edits.
-- Keep the data on rollback rather than unpublishing existing videos.
SELECT 1;
