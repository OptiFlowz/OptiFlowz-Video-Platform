# Video indexing

This module generates and stores video embeddings. The video module consumes them
through `GET /api/videos/search/vector`. Existing search and recommendation endpoints
continue to use their existing queries.

## Vector search

Example: `/api/videos/search/vector?q=laparoscopic%20surgery&sort=relevance&page=1&limit=20`.

The endpoint uses the same optional authentication, video card fields, and
`{ videos, pagination: { total, page, limit, totalPages } }` response as `/api/videos/search`.
It accepts the same `q`, `category`, comma-separated `tags`, `person`, `sort`, `page`,
and `limit` parameters. Sorting supports `relevance` (default), `date`, `views`, and
`likes`; unknown sort values fall back to date. Page and limit must be positive
integers, and the effective page size is capped at 100. Category/person filters
and tag overlap behave like the existing search.

With a nonempty `q`, the API embeds the trimmed query using the indexing model and
ranks each video by its highest cosine similarity across overview and subtitle
documents. Each video appears once. Only public, published, ready videos with an
enabled source and compatible published documents qualify. There is no similarity
cutoff: pagination totals count all qualifying indexed videos after the filters.
The last published documents remain searchable during reindexing; disabled sources
are excluded. The handler reads the primary database to check current visibility.

Empty or whitespace-only `q` uses the existing browse query, including unindexed
videos, without calling OpenAI. Nonempty queries require `OPENAI_API_KEY` in the API
process and incur an embedding request per search. Queries above 6000 UTF-8 bytes
return 400, missing configuration returns 503, and embedding failures return 502.
No new database migration is required beyond the video indexing migration.

## Run

1. Install pgvector on PostgreSQL and apply the database migrations with `npm run migrate:deploy`.
2. Configure `DATABASE_URL`, `OPENAI_API_KEY`, `MUX_TOKEN_ID`, and `MUX_TOKEN_SECRET`.
   Signed subtitle downloads also need the existing `MUX_SIGNING_KEY` and `MUX_PRIVATE_KEY`.
3. Locally, run `npm run dev:all` to start the API and indexing worker together,
   with automatic restarts on source changes and labelled output. Stop both with
   Ctrl+C. `npm run dev` still starts only the API; `npm run worker:video-indexing`
   starts only the worker without automatic reload.
4. Configure Mux to deliver `video.asset.ready`, `video.asset.track.ready`,
   `video.asset.track.deleted`, `video.asset.track.errored`, and `video.asset.deleted`
   to the existing `/api/videos/webhook/mux` endpoint, using `MUX_WEBHOOK_SECRET`.
5. Optionally enqueue existing videos using `npm run backfill:video-indexing`.
   Use `npm run backfill:video-indexing -- --force` to request fresh revisions,
   including recovery after fixing a permanently failed job. Disabled subtitle
   tracks remain disabled. Backfill itself does not call OpenAI; running workers
   consume the queued jobs and can incur embedding charges.

Apply the migration before deploying the API changes. The API queues jobs even if
the worker is stopped or its OpenAI credentials are unavailable.

## Fly deployment

`fly.toml` defines two process groups: `app` for the API and `worker` for indexing.
Only `app` receives HTTP traffic. Each group runs on its own Fly Machine using the
same application image and application secrets; the worker requires `OPENAI_API_KEY`
and the Mux/database configuration described above in the Fly app's secrets.
Local `.env` values are not automatically uploaded as Fly secrets.

Deploy the configuration with `fly deploy -a video-platform-template`. After deployment,
use `fly scale count worker=1 -a video-platform-template` to keep one indexing worker
without changing the API machine count. The worker uses the configured 1 GB VM size
and incurs an additional Machine charge. It stays running to poll the database queue.
These commands target the API application, not the PostgreSQL server application.

See [Fly process groups](https://fly.io/docs/launch/processes/).

## Responsibilities

- `indexing.service.js`: transactional overview scheduling and deletion invalidation.
- `mux-source.service.js`: reconcile selected subtitle tracks against current Mux state.
- `documents.js`: deterministic overview text and timestamped WebVTT chunks.
- `embedding.service.js`: bounded OpenAI embedding requests.
- `indexing.worker.js`: claims, retries, revision checks, and atomic publication.
- `src/workers/video-indexing.js`: process lifecycle and graceful shutdown.

This is internal processing, so it has no public routes or controller. Existing
video route handlers call the service. The worker uses the primary database only.

## Behavior

Creation and patches containing title, description, tags, or chapters enqueue an
overview in the same transaction as the video edit. Other patches do not enqueue it.
Repeated content may create a revision, but identical stored text reuses its embedding.

One subtitle track is selected per language. Reconciliation keeps the current track
when present, otherwise chooses a ready track deterministically by ID. Duplicate
webhooks do not create another revision. Track deletion and reconciliation hold the
video row lock during the bounded Mux operation so they cannot interleave with
publication. A deleted selected track is retained as a disabled source tombstone.
Replacing it with a new track ID creates a new revision. Failed Mux deletions roll
back the local invalidation; successful deletions remove documents immediately.

Workers claim one job at a time using `FOR UPDATE SKIP LOCKED`. Multiple worker
processes can run. Claims last 120 seconds and renew between bounded API calls.
A crashed worker's lease expires and another worker can reclaim it with a fresh
token. Up to five attempts use exponential delays starting at five seconds, capped
at five minutes. Shutdown aborts active HTTP calls and releases the job for retry.

Publication locks video, source, and job in that order, checks the revision, track,
enabled state, and lease, then replaces documents and completes the job in one
transaction. Deleted or outdated work cannot publish. An already running external
request may finish before the next check; cancellation does not guarantee avoiding
that request's cost. PostgreSQL cascades clean up a deleted video's records.

Overview input reserves UTF-8 byte budgets for title (800), description (3000),
tags (700), and chapters (1300), truncating longer fields. Subtitle chunks have
a 6000-byte ceiling and normally span at most 90 seconds; an individual long cue
retains its original timestamps. Files over 10 MB are rejected. Chunks currently
do not overlap. Each embedding request contains at most 16 texts.

The fixed model is `text-embedding-3-small`, dimensions 1536, indexing version 1.
Changing the model/dimensions requires a compatible schema and full reindex.
Changing preparation logic requires advancing `INDEX_VERSION` and forcing backfill.

Monitor `video_indexing_jobs` grouped by status and sources where
`enabled AND desired_revision > indexed_revision`. Completed and cancelled jobs
are retained for diagnostics; configure retention as the queue grows.

References: [OpenAI embeddings API](https://developers.openai.com/api/reference/resources/embeddings/methods/create)
and [Mux webhook events](https://www.mux.com/docs/core/listen-for-webhooks).
