# Live streams and recordings

For each route's inputs, response fields and permissions, see
[Livestream API reference](LIVE_STREAM_ROUTES.md).

Apply the existing live-stream migrations followed by
`1790553600002_live-stream-recordings.sql` and
`1790640000000_add-live-playback-cleanup.sql` and
`1790640000001_add-live-stream-permissions.sql` before deploying this code.
The recordings migration copies ownership and metadata to `live_streams`, moves the
relationship to nullable `videos.live_stream_id`, and preserves existing video
IDs, metadata, publication and interactions. Existing empty placeholder videos
are retained and reused for the first recording. New streams have no placeholder.
The migration refuses automatic downgrade because multiple recordings cannot
be represented by the previous one-to-one model.

## API and ownership

Management routes use the existing permission middleware and owned-resource
authorization. All paths below are relative to `/api/live-streams`.

| Route | Permission |
| --- | --- |
| `POST /` | `live_streams.create` |
| `GET /my/lives` | `live_streams.update_own`, matching the video management library |
| `PATCH /:liveStreamId` | `live_streams.update_own` or `live_streams.update_any` |
| `POST /:liveStreamId/thumbnail` | `live_streams.update_own` or `live_streams.update_any` |
| `DELETE /:liveStreamId` | `live_streams.delete_own` or `live_streams.delete_any` |
| `GET /:liveStreamId/streaming-details` | `live_streams.stream_own` or `live_streams.stream_any` |

`*_own` requires ownership; `*_any` permits the action on another user's stream.
The platform Owner role retains its authorization bypass. Uploaders receive
create/update-own/delete-own/stream-own; Administrators receive all seven keys.
The migration preserves existing permission grants and denies. Viewer and
Moderator roles receive no livestream management grants by default.
Encoder credential access is separate from metadata editing. Creating a stream
still returns its initial encoder credentials under `live_streams.create`.
Authorization runs before thumbnail parsing or Mux/R2 operations. Authenticated
callers lacking access receive 403; missing resources receive 404.

Public cards retain optional authentication. Details and playback retain their
existing authentication and visibility checks, without management permissions.
Interactions on recordings continue using the existing video/comment permissions.

The details and playback handlers accept a nullable viewer ID and work with
either `requireAuth` or `optionalAuth`. Their routes currently use `optionalAuth`.
Public/unlisted streams allow guest access, while private streams remain owner-only (404
for guests and other viewers). Guest recording details return `user_reaction: 0`
and null watch progress. Signed playback tokens are also generated for allowed
guests, for both DVR and non-DVR playback. Invalid supplied authentication still
returns 401 through `optionalAuth`.

`POST /api/live-streams/:liveStreamId/playback` uses optional authentication.
Public and unlisted streams are viewable by guests and signed-in users;
private streams are owner-only (404 for everyone else). Playback requires
application status `live` or `disconnected` and Mux status `active`. Scheduled,
ended, cancelled, idle and disabled streams return 409. Finished replays use the
existing video playback route instead.

Following [Mux's DVR playback model](https://www.mux.com/docs/guides/stream-recordings-of-live-streams),
non-DVR uses `mux_live_playback_id`; DVR uses the unfinished recording whose asset
matches `mux_active_asset_id`. A recording can be `preparing` in the application
while its Mux playback ID already works for DVR; it need not be published as a
replay. Missing DVR IDs return 409 with no fallback to an older asset or to
non-DVR. Access to this in-progress content is governed by livestream visibility.

The response includes `livestream_id`, current `video_id` (or null), `status`,
`dvr_enabled`, `playback_mode` (`live`/`dvr`), `playback_source`
(`live_stream`/`asset`), `mux_playback_id`, `playback_policy`, `stream_url`,
`tokens` and `expires_at`. The policy belongs to the selected playback resource:
DVR uses the recording's own policy, which may differ if the livestream's policy
was edited after that recording started. Public playback returns an unsigned HLS
URL, empty tokens and null expiry. Signed playback returns separate playback,
thumbnail and storyboard JWTs, and puts the playback token in the HLS URL.
Tokens last one hour; refresh through this route before `expires_at` (Unix
seconds). Responses use `Cache-Control: private, no-store`, and every request
checks current access on the primary database. Missing signing keys return 503.

`GET /api/live-streams/users/:userId/cards` is a public, optionally authenticated
listing. It returns `{ success, cards, page, limit, total, total_pages, sort_by,
sort_dir }`. Defaults are page 1, limit 20 (maximum 100), `sort_by=streamed_at`,
and `sort_dir=desc`; use `sort_by=views` (or `view_count`) and `asc`/`desc`.
Pagination and ordering apply across both card sources, with deterministic ties.

Only public parent livestreams are eligible. Each public, ready recording that
is already published (`published_at <= now()`, matching other public video lists)
gets a normal video card with its own title, thumbnail, duration, view count,
people, Mux image/preview URLs and optional viewer watch progress. A public live
stream always gets exactly one independent `live` card, including while Mux is
creating a preparing recording. Eligible recordings can coexist with that card.
A scheduled stream gets a card only when it has no video rows. Private, unlisted,
processing, deleted, draft or future-publication recordings never produce video
cards. Multiple eligible recordings produce multiple cards. Signed playback does
not exclude publicly visible content.

Every card includes `card_type` (`recording`, `scheduled`, `live`), `livestream_id`,
`video_id`, `livestream_status`, `streamed_at`,
`scheduled_at`, `started_at`, `ended_at`, `dvr_enabled`, `recording_started_at`
and `recording_completed_at`. `id` is the video ID for recordings or the stream
ID otherwise. `streamed_at` is the recording start, falling back to the stream's
start/connection time; upcoming streams have null until they start. Date sorting
falls back to the scheduled time, then creation time when start time is absent.
Scheduled/live cards currently have `view_count: 0`, no duration, and null
Mux image/preview URLs; their custom livestream thumbnail is retained.
The owner's authentication never expands this public listing to private content.
For `live` cards, `video_id` identifies the unfinished, non-deleted recording
whose Mux asset matches `mux_active_asset_id`. It is null until that recording
exists, or if the matching recording has completed or been deleted; no other
recording is substituted. Scheduled cards have null `video_id`. Live cards still
use livestream metadata, with no video preview, people, or watch progress.

`PATCH /api/live-streams/:liveStreamId` requires update access and accepts a partial
JSON body containing `title`, `description`, `scheduled_at`, `playback_policy`
and/or `visibility`. Title is trimmed, nonempty, and at most 512 characters.
Description and scheduled date may be null; dates otherwise require an ISO
timestamp with a timezone. Policy is `public` or `signed`; visibility is
`public`, `unlisted` or `private`. Empty bodies, `dvr_enabled`, and other fields
are rejected with 400. Omitted fields and lifecycle state remain unchanged.
The response is `{ success: true, live_stream: { ... } }`.

A policy change creates a replacement live playback ID, commits it with the
new policy and a pending cleanup ID, then deletes the old playback ID. A cleanup
failure returns 502; the saved policy remains in effect, and retrying the request
finishes deletion without creating another ID. Mux 404 counts as already deleted.
The additional migration stores this pending cleanup, as video policy edits do.
Delayed webhooks cannot replace the saved live playback ID with an older one.

Existing recordings keep their own details and policy. New recordings inherit
the current stream metadata/policy. Mux does not allow changing playback policy
in an existing stream's [new asset settings](https://www.mux.com/docs/api-reference/video/live-streams/update-live-stream).
When a recording arrives with the original Mux policy, the asset webhook creates
or reuses a playback ID with the inherited policy and deletes IDs of the other
policy before saving readiness. Retries read Mux state to reuse the replacement.

`GET /api/live-streams/my/lives` lists only the authenticated user's streams,
including scheduled, live, disconnected, ended and cancelled streams.
Query parameters: `page` (default 1), `limit` (default 20, maximum 100),
`sort_by` (`created_at`, `scheduled_at`, `started_at`, `updated_at`, `title`,
`status`, `visibility`) and `sort_dir` (`asc`, `desc`, default `desc`).
For comments-style sorting, `sort=new` (default) or `sort=old` sets the direction
unless `sort_dir` is supplied. Missing dates always sort last, with ID as a
stable tiebreaker. Invalid pagination/sorting values return 400.
The response contains `live_streams`, `page`, `limit`, `total`, `total_pages`,
`sort_by`, and `sort_dir`. Each stream includes its ID/owner, title, description,
thumbnail, application/Mux status, visibility, playback policy, DVR setting,
schedule and lifecycle timestamps. Encoder credentials and internal webhook
tracking fields are excluded. Responses use `Cache-Control: private, no-store`.

`GET /api/live-streams/:liveStreamId` uses optional authentication.
Public and unlisted streams are available to guests and signed-in viewers; private streams
are visible only to their owner (otherwise 404). It returns
`{ success: true, live_stream: { ... } }` with title, description, thumbnail,
application and Mux status, visibility, playback policy, DVR setting, schedule,
lifecycle dates, creation/update dates and uploader ID/name/image.

`live_stream.video_id` and `live_stream.current_recording` identify the current
unfinished recording for a `live` or `disconnected` stream. Selection matches
the active Mux asset, never the most recently created video. Preparing,
unpublished recordings are included under the livestream's visibility rules.
The nested recording includes its metadata, Mux status, policy, duration,
recording dates, views/likes/dislikes, comment count and the requesting user's
reaction and watch progress. Both fields are null when there is no matching
unfinished recording, it was deleted, or the stream is scheduled/ended/cancelled.
Completed recordings remain available through video details and public cards.
This read does not increment views. Responses use `Cache-Control: private,
no-store`; playback URLs/tokens come from the separate playback route.

`POST /api/live-streams` accepts `title`, `description`, `visibility`,
`playback_policy`, `dvr_enabled` and `scheduled_at`. It returns `live_stream`,
`stream_key` and `max_continuous_duration`; it no longer returns `video`.
The stream owns its metadata and `user_id`, independently of its recordings.
`GET /api/live-streams/:liveStreamId/streaming-details` checks streaming access and
returns non-cacheable credentials even when no recordings exist.

`POST /api/live-streams/:liveStreamId/thumbnail` requires update access.
Send multipart form-data with a `file` field (JPEG, PNG or WebP, up to 5 MB).
The dedicated livestream handler rotates/crops the image to 1280x720 WebP
(quality 82), uploads it under `live-stream-thumbnails/<id>/`, and returns
`{ success: true, live_stream: { id, thumbnail_url } }`.
Calling the same route without a file clears the thumbnail. Replacement and
removal clean up the old livestream object; the video thumbnail handler is unchanged.
Replacement also gives each recording whose `mux_status` is exactly `preparing`
its own new R2 copy; removal clears those recordings' thumbnails too. Recordings
in all other states retain their thumbnails. These database changes commit
together, then the replaced objects are removed from R2.

Each new Mux asset creates a video with `live_stream_id` and copies the stream's
owner, metadata, visibility and playback policy. Reconnects within the Mux
reconnect window retain the same asset/video. Later recording sessions create
new video IDs, with their own playback IDs, duration, status and interactions.
The existing video reaction, comment and playback handlers are reused.
Creation is serialized by a parent row lock and a unique recording asset index.
If the stream has a thumbnail, recording creation copies the R2 object to a
new key under `video-thumbnails/<videoId>/` and stores that copy's URL. A null
stream thumbnail stays null. Later Mux events do not generate a fallback or
overwrite the recording thumbnail. Duplicate webhooks do not recopy it.
Copy failure rolls back creation; a database failure cleans up the unused copy.
A new video calls `scheduleOverview` in
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

`DELETE /api/live-streams/:liveStreamId` requires delete access. It disables Mux,
collects all recording assets using `next_cursor`, deletes the assets and Mux
stream, then deletes the local stream. Its videos and dependent records cascade.
Before removing local records, it deletes the livestream thumbnail and all
recording thumbnail copies from R2. R2 cleanup failures preserve the database
records so deletion can be retried. Upload, recording copy and final deletion
lock the parent stream to avoid racing over thumbnails.
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

Run `npm run test:live-streams`, `npm run test:live-thumbnails`, `npm run test:live-streams:db`,
`npm run test:live-details`, `npm run test:live-permissions`, `npm run test:live-playback`, `npm run test:user-live-cards`,
`npm run test:mux-webhooks` and `npm run test:video-deletion`.
Set `TEST_DATABASE_URL` for PostgreSQL checks. They create connection-local
temporary tables, apply migrations there, and mock all Mux and R2 mutations.
