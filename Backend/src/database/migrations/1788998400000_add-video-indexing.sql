-- Up Migration

-- The pgvector extension must be installed on the PostgreSQL server.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE public.video_indexing_sources (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    video_id uuid NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
    document_type text NOT NULL
        CHECK (document_type IN ('overview', 'transcript_chunk')),
    language text NOT NULL DEFAULT 'und' CHECK (btrim(language) <> ''),
    source_track_id text CHECK (btrim(source_track_id) <> ''),
    enabled boolean NOT NULL DEFAULT true,
    desired_revision bigint NOT NULL DEFAULT 1 CHECK (desired_revision > 0),
    indexed_revision bigint NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT video_indexing_sources_revision_check
        CHECK (indexed_revision >= 0 AND indexed_revision <= desired_revision),
    CONSTRAINT video_indexing_sources_track_check CHECK (
        (document_type = 'overview' AND source_track_id IS NULL)
        OR
        (document_type = 'transcript_chunk'
            AND (enabled = false OR source_track_id IS NOT NULL))
    ),
    CONSTRAINT video_indexing_sources_language_unique
        UNIQUE (video_id, document_type, language),
    -- Allows documents to enforce that their video, type and language match
    -- the source while retaining the track ID and revision of the indexed text.
    CONSTRAINT video_indexing_sources_identity_unique
        UNIQUE (id, video_id, document_type, language)
);

CREATE UNIQUE INDEX video_indexing_sources_one_overview_idx
ON public.video_indexing_sources (video_id)
WHERE document_type = 'overview';

CREATE INDEX video_indexing_sources_track_idx
ON public.video_indexing_sources (source_track_id)
WHERE source_track_id IS NOT NULL;

CREATE TABLE public.video_indexing_jobs (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_id uuid NOT NULL
        REFERENCES public.video_indexing_sources(id) ON DELETE CASCADE,
    requested_revision bigint NOT NULL CHECK (requested_revision > 0),
    -- Snapshot of the selected track when this job was requested.
    source_track_id text CHECK (btrim(source_track_id) <> ''),
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
    available_at timestamptz NOT NULL DEFAULT now(),
    locked_at timestamptz,
    locked_until timestamptz,
    lease_token uuid,
    last_error text,
    finished_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT video_indexing_jobs_revision_unique
        UNIQUE (source_id, requested_revision),
    CONSTRAINT video_indexing_jobs_lease_check CHECK (
        (status = 'processing'
            AND locked_at IS NOT NULL
            AND locked_until IS NOT NULL
            AND locked_until > locked_at
            AND lease_token IS NOT NULL)
        OR
        (status <> 'processing'
            AND locked_at IS NULL
            AND locked_until IS NULL
            AND lease_token IS NULL)
    ),
    CONSTRAINT video_indexing_jobs_finished_check CHECK (
        (status IN ('completed', 'failed', 'cancelled') AND finished_at IS NOT NULL)
        OR
        (status IN ('pending', 'processing') AND finished_at IS NULL)
    )
);

CREATE INDEX video_indexing_jobs_pending_idx
ON public.video_indexing_jobs (available_at, created_at, id)
WHERE status = 'pending';

CREATE INDEX video_indexing_jobs_expired_lease_idx
ON public.video_indexing_jobs (locked_until, id)
WHERE status = 'processing';

CREATE TABLE public.video_documents_pg (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_id uuid NOT NULL,
    video_id uuid NOT NULL,
    document_type text NOT NULL
        CHECK (document_type IN ('overview', 'transcript_chunk')),
    language text NOT NULL DEFAULT 'und' CHECK (btrim(language) <> ''),
    source_revision bigint NOT NULL CHECK (source_revision > 0),
    source_track_id text CHECK (btrim(source_track_id) <> ''),
    chunk_index integer NOT NULL DEFAULT 0 CHECK (chunk_index >= 0),
    text text NOT NULL CHECK (btrim(text) <> ''),
    embedding vector(1536) NOT NULL,
    embedding_model text NOT NULL DEFAULT 'text-embedding-3-small'
        CHECK (embedding_model = 'text-embedding-3-small'),
    index_version integer NOT NULL DEFAULT 1 CHECK (index_version > 0),
    content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    start_seconds double precision,
    end_seconds double precision,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(metadata) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT video_documents_source_fk
        FOREIGN KEY (source_id, video_id, document_type, language)
        REFERENCES public.video_indexing_sources (id, video_id, document_type, language)
        ON DELETE CASCADE,
    CONSTRAINT video_documents_chunk_unique UNIQUE (source_id, chunk_index),
    CONSTRAINT video_documents_type_check CHECK (
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
    )
);

CREATE INDEX video_documents_video_id_idx
ON public.video_documents_pg (video_id);

CREATE INDEX video_documents_type_language_idx
ON public.video_documents_pg (document_type, language);

COMMENT ON TABLE public.video_indexing_sources IS
    'Current desired source state. Update revision and enqueue work in the same transaction as source edits.';
COMMENT ON TABLE public.video_indexing_jobs IS
    'Durable indexing work. Workers must verify source revision, enabled state, track ID and current lease ownership before committing documents.';
COMMENT ON TABLE public.video_documents_pg IS
    'Successfully embedded documents. Replace affected documents and advance indexed_revision atomically; old revisions may remain searchable until replacement.';
COMMENT ON COLUMN public.video_documents_pg.content_hash IS
    'Lowercase SHA-256 of the exact embedding text plus embedding model, dimensions and indexing version.';
COMMENT ON COLUMN public.video_indexing_jobs.lease_token IS
    'Generate a fresh token on every claim or reclaim. An expired worker must not save results or complete a job after losing its lease.';

-- updated_at is maintained by the application when a row changes.
-- Start with exact vector search; add an approximate index after measuring recall
-- and latency with the actual video/language/visibility filters.

-- Down Migration

DROP TABLE public.video_documents_pg;
DROP TABLE public.video_indexing_jobs;
DROP TABLE public.video_indexing_sources;

-- Keep the shared vector extension: it may predate this migration or be used
-- by other tables in the database.
