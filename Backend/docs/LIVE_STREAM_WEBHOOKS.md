# Live streams and recordings

Apply the existing live-stream migrations followed by
`1790553600002_live-stream-recordings.sql` before deploying this code.
The new migration copies ownership and metadata to `live_streams`, moves the
relationship to nullable `videos.live_stream_id`, and preserves existing video
IDs, metadata, publication and interactions. Existing empty placeholder videos
are retained and reused for the first recording. New streams have no placeholder.
The migration refuses automatic downgrade because multiple recordings cannot
be represented by the previous one-to-one model.

## API and ownership

`POST /api/live-streams` accepts `title`, `description`, `visibility`,
`playback_policy`, `dvr_enabled` and `scheduled_at`. It returns `live_stream`,
`stream_key` and `max_continuous_duration`; it no longer returns `video`.
The stream owns its metadata and `user_id`, independently of its recordings.
`GET /api/live-streams/:liveStreamId/streaming-details` checks that owner and
returns non-cacheable credentials even when no recordings exist.

Each new Mux asset creates a video with `live_stream_id` and copies the stream's
owner, metadata, visibility and playback policy. Reconnects within the Mux
reconnect window retain the same asset/video. Later recording sessions create
new video IDs, with their own playback IDs, duration, status and interactions.
The existing video reaction, comment and playback handlers are reused.
Creation is serialized by a parent row lock and a unique recording asset index.
The recording copies `thumbnail_url` exactly, including null; later Mux events
do not generate a fallback thumbnail. A new video calls `scheduleOverview` in
the same transaction as its insertion. Scheduling failure rolls back creation,
and duplicate webhooks reuse the video without scheduling another overview.

## Webhook lifecycle

Mux sends events to `POST /api/videos/webhook/mux`. Signature validation and
credential-redacted logging run before processing.

| Event | Application behavior |
| --- | --- |
| `video.live_stream.active` | Set status `live`. |
| `video.live_stream.disconnected` | Set status `disconnected`; Mux may remain `active` during its reconnect window. |
| `video.live_stream.connected` / `recording` | Track the connection and current asset; return to `live` when the connection is active. |
| `video.live_stream.idle` | After reconnect expiry, return to `scheduled` if the event happened before `scheduled_at`; otherwise end a started stream. |
| `video.asset.live_stream_completed` | Finalize that recording; apply the same schedule rule to its session without closing a newer session. |
| `video.asset.ready` | Save playback details for that recording. DVR readiness alone does not mark it as a completed VOD. |
| `video.asset.deleted` | Mark only that recording deleted and clear its playback ID. Preserve the stream and other recordings. |
| `video.live_stream.deleted` | End/cancel the application stream and preserve its recordings. |

Schedule comparisons use the Mux event time, not delivery time. Expiry exactly
at or after `scheduled_at`, or with no schedule, ends the event. Early completed
recordings remain available as separate videos. Their completion and delayed
webhooks cannot overwrite another recording or end its newer session.
Returning to `scheduled` clears the application session timestamps; Mux remains
idle and enabled. There is no disable or enable API call for this transition.

Ended streams are disabled through Mux after the database transaction commits.
Failures remain retryable through webhook redelivery. Ended/cancelled events
are not reopened by delayed events. Playback policy selection, independent
recording event timestamps and final duration handling are preserved.

Recording readiness does not automatically publish it: `published_at` remains
unchanged. Transcript reconciliation uses the individual recording's video ID.

## Deletion

`DELETE /api/live-streams/:liveStreamId` requires ownership. It disables Mux,
collects all recording assets using `next_cursor`, deletes the assets and Mux
stream, then deletes the local stream. Its videos and dependent records cascade.
It returns `success`, `live_stream_id` and `message`.

Deleting a single video removes only that recording. It never deletes or
disables the parent or sibling recordings. A parent-side asset tombstone prevents
late webhooks from recreating the explicitly deleted video.

Mux 404 means already absent and permits local cleanup. Other Mux failures
preserve local records for retry. An accepted DELETE (204) does not wait for a
webhook or poll for removal. Cursor listing avoids the installed SDK's numeric
page iterator, which can repeatedly return the same page. Error logs include
the failing operation, status and elapsed time without credentials.

## Verification

Run `npm run test:live-streams`, `npm run test:live-streams:db`,
`npm run test:mux-webhooks` and `npm run test:video-deletion`.
Set `TEST_DATABASE_URL` for PostgreSQL checks. They create connection-local
temporary tables, apply migrations there, and mock all Mux mutations.
