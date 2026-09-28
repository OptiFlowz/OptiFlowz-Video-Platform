# Live stream webhooks

Mux sends live stream and recording events to the existing
`POST /api/videos/webhook/mux` endpoint. Signature verification uses
`MUX_WEBHOOK_SECRET` and the raw request body, before any database work.

Apply `1790553600000_add-live-streams.sql` and
`1790553600001_add-live-stream-webhook-state.sql` before deploying this handler.
The second migration adds independent event timestamps for the live resource
and its recording, plus a unique index on `mux_live_stream_id`.

## Lifecycle

| Event | Effect |
| --- | --- |
| `video.live_stream.created` / `updated` | Refresh the live playback ID matching the video's playback policy. |
| `video.live_stream.connected` | Record the latest encoder connection and associate `active_asset_id` with the video. |
| `video.live_stream.recording` | Associate the recording asset; recording can begin while Mux status is still `idle`. |
| `video.live_stream.active` | Set application status to `live`, Mux status to `active`, and record the first start time. |
| `video.live_stream.disconnected` | Record the disconnect while leaving the reconnect window open. |
| `video.live_stream.idle` | End an event that has started; initial idle notifications do not end scheduled events. |
| `video.live_stream.disabled` / `enabled` | Update Mux availability without undoing an ended/cancelled application event. |
| `video.live_stream.deleted` | Disable the local Mux resource and end/cancel the event. Preserve the video and recording. |
| `video.asset.created` / `ready` / `updated` | Associate the recording and save its playback ID, duration and default thumbnail. |
| `video.asset.live_stream_completed` | Finalize the recording on the existing video and end the event if idle has not arrived yet. |
| `video.asset.errored` | Mark the recording as errored. |
| `video.asset.deleted` | Mark the recording as deleted and clear its playback ID. Preserve the video, reactions and comments. |

Warnings and unsupported events are acknowledged without changing lifecycle.
Uploaded videos and subtitle track events retain their existing handlers.

## Recording and publication

Asset events are matched through `data.live_stream_id`, with the saved asset ID
as a fallback when Mux omits the live ID. Recording fields belong to `videos`;
live playback fields belong to `live_streams`. Playback IDs must match the
video's `playback_policy`; there is no fallback to a public playback ID.

A recording can be ready for DVR during the broadcast. Its playback ID is saved,
but `videos.mux_status` remains `preparing` until recording completion and asset
readiness are both known. Transcript reconciliation runs after finalization.
The webhook preserves `published_at`, visibility, ownership and user metadata.
Publishing the replay remains a separate operation, as for uploaded videos.

Each application live event owns one recording. Once bound, a different asset
from a subsequent broadcast using the same Mux stream key is ignored. Create a
new application livestream for a new broadcast. Reconnects within the same
recording continue to use the original video and preserve its interactions.

Both rows are locked and updated in one transaction. Event timestamps and
terminal-state checks prevent older snapshots from undoing finalization.
Retries after a post-commit transcript failure repeat reconciliation safely.

When the application event becomes `ended`, the webhook calls Mux's disable API
after committing and releasing database locks. Only a successful disable (or a
404 confirming the resource is gone) saves `mux_status = 'disabled'`. Mux API
failures return a retryable error so webhook redelivery can finish disabling.
Duplicate completion notifications do not repeat a successful disable. A newer
enable or encoder connection event on an ended stream triggers disable again.
Initial idle notifications and temporary disconnects do not disable a stream.

## Explicit deletion

`DELETE /api/live-streams/:liveStreamId` requires an access token and ownership
of the associated video. It returns 200 with `success`, `live_stream_id`,
`video_id`, `mux_asset_id` and `message`; a missing stream or another owner's
stream returns 404.

Deletion disables the Mux stream, gathers all its recording assets (including
assets not yet saved by a webhook), deletes those assets and the Mux stream,
then deletes the video row. Database foreign keys cascade to the live stream,
reactions, comments and other dependent records. The existing video deletion
route uses the same cleanup, including the Mux live stream for recordings.

Mux 404 responses on retrieve, disable or delete mean the resource is already
gone and do not block local deletion. Other upstream failures return 502 and
leave local records available for retry. Local deletion does not depend on
receiving `video.asset.deleted`; this also fixes deletion of ordinary videos
whose Mux asset was previously removed. Standalone Mux deletion webhooks retain
the preservation behavior described above for live recordings.

Asset listing explicitly follows `next_cursor` and stops when it is null.
The installed Mux SDK's auto-pagination increments `page`, which the API can
ignore and repeatedly return the same nonempty page. Do not replace cursor
pagination with the SDK's async iterator. Repeated cursors fail promptly.
A successful DELETE response (204) is accepted without waiting for the
asynchronous deletion webhook or polling until the resource disappears.
Upstream failures log the operation, HTTP status and elapsed time without
logging credentials or raw Mux responses.

Run `npm run test:video-deletion` for deletion, retry and ownership tests.
Set `TEST_DATABASE_URL` to also verify deletion and foreign-key cascades against
connection-local PostgreSQL temporary tables; Mux calls remain mocked.

## Verification

Run `npm run test:mux-webhooks`. Setting `TEST_DATABASE_URL` also enables the
PostgreSQL tests, which copy the video's column definitions into temporary
tables and apply the live migrations only to those connection-local tables.
They never write application tables or create real Mux resources.

References: [Mux lifecycle and recordings](https://www.mux.com/docs/guides/stream-recordings-of-live-streams)
and [Mux webhook reference](https://www.mux.com/docs/webhook-reference).
