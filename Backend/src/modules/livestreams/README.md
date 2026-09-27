# Livestreams

The module follows the existing route → controller → handler structure:

- `livestream.routes.js`: authentication, permission checks, route declaration.
- `livestream.controller.js`: HTTP status and shared success/error envelopes.
- `handlers/createLivestream.js`: validation, Mux provisioning, database writes.

## Create a livestream

`POST /api/livestreams`, with a bearer access token and `livestreams.create`.
The authenticated user becomes `videos.uploaded_by`; client-supplied owner,
status, kind, and provider IDs are rejected.

```json
{
  "title": "Weekly live session",
  "description": "Questions and answers",
  "mode": "dvr",
  "visibility": "public",
  "playback_policy": "signed",
  "scheduled_start_at": "2027-01-01T18:00:00+01:00",
  "max_duration_seconds": 7200
}
```

Only `title` is required (1–255 characters after trimming). Description is
optional, nullable, and limited to 10,000 characters. Mode defaults to
`standard`; visibility to `private`; playback policy to `signed`. Private
livestreams cannot use public playback. The optional planned start time accepts
an ISO timestamp with timezone or null; it is scheduling metadata, not a timer
or a provider-side restriction on when broadcasting can begin.

Duration must be an integer from 60 to 43,200 seconds. DVR must be strictly
below 14,400 seconds. Defaults are 43,200 for standard and 14,399 for DVR.
Creation reserves up to 60 seconds of that budget for Mux's reconnect window:
`max_continuous_duration = max_duration_seconds - reconnect_window`.
For a 60-second limit, the reconnect window is zero. Both modes currently use
standard latency; DVR controls historical playback, not transport latency.

The backend explicitly creates `videos.kind = 'live'`, sets `published_at` to
now for public visibility (null for private), and inserts `video_livestreams`
with status `scheduled`. The parent and child are committed together. A future
scheduled start does not prevent publishing the event page now.

Mux receives the video ID in the top-level stream `passthrough` and copies it
to recording assets automatically. Do not send `new_asset_settings.passthrough`:
the live-stream creation API rejects that field, even though the shared SDK
asset type permits it. Both resources receive matching playback policies. The live playback ID is
stored on `video_livestreams`; recording IDs are synchronized by lifecycle
webhooks and the API background scheduler. Initial Mux `idle` is represented as `scheduled`.

Success returns HTTP 201 with `{ "success": true, "livestream": { ... } }`.
The livestream object contains the persisted video fields, `video_id`, mode,
status, Mux live IDs, schedule, duration limit, and lifecycle timestamps.
It does not include stream keys or other ingest credentials. The separate
credential endpoint checks broadcast permission and ownership.

Errors use `{ "success": false, "message": "..." }`: 400 for validation,
401 for missing/invalid authentication, 403 for missing/denied create permission,
503 for missing `MUX_TOKEN_ID` or `MUX_TOKEN_SECRET`, 502 for Mux provisioning
failure, and 500 for database failure.

## Failure handling

Known failures before commit roll back database writes and attempt to delete
the newly provisioned Mux stream. Provider creates have automatic SDK retries
disabled to avoid duplicating resources. Provider request timeouts, failed
cleanup, or lost commit acknowledgements can need operator reconciliation;
logs contain correlation IDs and selected, redacted Mux status/type/messages.
Definitive Mux validation failures do not produce reconciliation warnings. An uncertain commit
does not trigger provider deletion, since the rows might have committed.

Creation does not initialize `started_at` or `stop_at` before broadcasting begins.
The first observed recording establishes the start/deadline; reconnects preserve it.

Mux API reference: https://www.mux.com/docs/api-reference/video/live-streams/create-live-stream

Run `npm run test:livestreams`. Set `TEST_DATABASE_URL` to a local test database
to also exercise migrations and persistence with temporary tables. Tests never
contact Mux or use production database credentials.

## Additional routes

All livestream module routes require bearer authentication. Ownership checks allow
the corresponding *_any permission and the platform Owner override.

| Method | Path | Permission / behavior |
| --- | --- | --- |
| GET | /api/livestreams | livestreams.library.read; public published events |
| GET | /api/livestreams/search | Same list, with q title/description search |
| GET | /api/livestreams/my | livestreams.update_own; all own events, including private |
| GET | /api/channels/:id/livestreams | Public channel events; optional authentication |
| GET | /api/livestreams/:videoId/credentials | livestreams.broadcast_own/any; no-store stream key and RTMPS URL |
| PATCH | /api/livestreams/:videoId/settings | livestreams.update_own/any; scheduled, unused broadcasts only |
| POST | /api/livestreams/:videoId/end | livestreams.broadcast_own/any; disable ingest, then finalize asynchronously |
| GET | /api/analytics/:videoId/concurrent-viewers | analytics.livestream_own.read/any.read |

Lists accept q, status, channel_id, page (default 1), limit (default 20, max 100).
Settings accept mode, scheduled_start_at, max_duration_seconds. When switching
to DVR, also supply a duration below 14400 if the current limit is too high.
The encoder starts the broadcast by connecting with the credentials; no separate
HTTP start action is required. End cancels an unused event or starts finalization.

## Shared video routes

Use the existing /api/videos/:id details and /:id/playback routes for both kinds.
Playback returns stream_type: on-demand, live, or live:dvr; unavailable playback
returns 409 with the lifecycle status. Live signed tokens expire after one hour;
clients must refresh through the playback endpoint. Details/cards include kind,
livestream metadata, playback_available, and stream_type for live content.
Scheduled events can show custom artwork without a Mux asset. Active streams do
not generate animated previews from a growing recording.

Metadata, thumbnails, comments, reactions and analytics support both kinds.
Progress, notes, subtitles, AI/chapter operations and quiz prerequisites require
a ready upload or a finalized recording. Completion/engagement analytics also
require finalized recordings. Heartbeats count live watch time without writing
a recording resume position. Concurrent viewers is a 30-second heartbeat-based
estimate, deduplicated by authenticated user or anonymous IP/user-agent pair.

Discovery (trending, recommendations, search, similar results, channel videos,
my videos, top-viewed-videos) remains upload-only. Similar results can use a live
item as their source. Playlists, post embeds, history and likes include lives;
continue watching includes finalized replays. Mixed personal lists filter each
kind by the caller's videos.library.read/livestreams.library.read permission.
Platform/channel content metrics accept kind=upload|live|all (default all).
User/signup and playlist metrics remain independent of content kind.

Shared mutation routes select videos.* versus livestreams.* permissions using
the stored kind. Live per-item analytics uses analytics.livestream_own.read or
analytics.livestream_any.read; the migration copies existing video analytics
role effects. Comments/notes retain their existing permissions plus visibility.

## Provider lifecycle and deployment

Apply all three livestream migrations, including 1790467200002_livestream-lifecycle.sql.
Lifecycle checks start automatically inside the API process when Mux credentials
are configured. No separate livestream process or machine is required. The API
checks active streams on a 15-second loop and scheduled events for missed starts
after five minutes without updates. Each sweep handles up to 100 records, with
active streams first. A PostgreSQL advisory lock prevents concurrent sweeps
across API replicas. Checks stop gracefully when the API shuts down.
Webhooks provide immediate transitions; the scheduler repairs missed events and
disables streams at their saved deadline. Recovery checks run while the API is up.
The signed Mux webhook remains POST /api/videos/webhook/mux and dispatches by
provider resource. Provider state is re-read to handle duplicate/out-of-order
notifications. asset.ready does not mean a broadcast is complete; finalization
requires a non-live, ready asset. One application video represents one broadcast;
its Mux stream is disabled after completion to prevent reuse.

Changing playback policy before broadcasting replaces the unused Mux stream,
because Mux cannot update future recording playback policies. Retrieve fresh
credentials afterward. After broadcasting starts, the live and recording IDs
are synchronized. Partial policy changes block new playback while pending;
retry the same policy to finish. Switching a public-policy live event to private
first requires switching it to signed playback. Existing issued tokens follow
their expiry/provider revocation behavior. Active broadcasts must end before deletion.

Provider documentation:
- https://www.mux.com/docs/guides/stream-recordings-of-live-streams
- https://www.mux.com/docs/api-reference/video/live-streams/update-live-stream
