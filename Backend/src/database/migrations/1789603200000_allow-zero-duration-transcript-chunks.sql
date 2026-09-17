-- Up Migration

ALTER TABLE public.video_documents_pg
    DROP CONSTRAINT video_documents_type_check,
    ADD CONSTRAINT video_documents_type_check CHECK (
        (document_type = 'overview'
            AND chunk_index = 0
            AND source_track_id IS NULL
            AND start_seconds IS NULL
            AND end_seconds IS NULL)
        OR
        (document_type = 'transcript_chunk'
            AND source_track_id IS NOT NULL
            AND start_seconds IS NOT NULL
            AND end_seconds IS NOT NULL
            AND start_seconds >= 0
            AND end_seconds >= start_seconds
            AND end_seconds < 'Infinity'::double precision)
    );

-- Down Migration

-- Refuse rollback if zero-duration documents exist; never discard indexed text
-- or alter source timestamps to satisfy the old constraint.
ALTER TABLE public.video_documents_pg
    DROP CONSTRAINT video_documents_type_check,
    ADD CONSTRAINT video_documents_type_check CHECK (
        (document_type = 'overview'
            AND chunk_index = 0
            AND source_track_id IS NULL
            AND start_seconds IS NULL
            AND end_seconds IS NULL)
        OR
        (document_type = 'transcript_chunk'
            AND source_track_id IS NOT NULL
            AND start_seconds IS NOT NULL
            AND end_seconds IS NOT NULL
            AND start_seconds >= 0
            AND end_seconds > start_seconds
            AND end_seconds < 'Infinity'::double precision)
    );
