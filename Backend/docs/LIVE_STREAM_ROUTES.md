# Livestream API reference

Base path: `/api/live-streams`.

This reference describes the currently mounted routes. All IDs in URL parameters
are UUIDs. JSON requests use `Content-Type: application/json`; authenticated
requests use `Authorization: Bearer <access-token>`. Times are ISO 8601 strings
with a timezone, for example `2026-10-01T18:00:00Z`, or null where allowed.

Success responses have `success: true`. Creation returns HTTP 201; all other
successful routes return HTTP 200. Examples use placeholder IDs and URLs.

## Access rules

| Method and path | Authentication | Required permission |
| --- | --- | --- |
| `POST /` | Required | `live_streams.create` |
| `GET /my/lives` | Required | `live_streams.update_own` |
| `GET /users/:userId/cards` | Optional | None |
| `PATCH /:liveStreamId` | Required | `live_streams.update_own` or `live_streams.update_any` |
| `POST /:liveStreamId/thumbnail` | Required | `live_streams.update_own` or `live_streams.update_any` |
| `GET /:liveStreamId/streaming-details` | Required | `live_streams.stream_own` or `live_streams.stream_any` |
| `POST /:liveStreamId/playback` | Optional | None |
| `GET /:liveStreamId` | Optional | None |
| `DELETE /:liveStreamId` | Required | `live_streams.delete_own` or `live_streams.delete_any` |

`*_own` also requires ownership of the requested stream. `*_any` allows that
operation on other users' streams. The platform Owner role bypasses management
permission checks. Uploaders receive create and the three own permissions;
Administrators receive all seven permissions. `/my/lives` always lists the
authenticated user's streams, even for an Administrator or platform Owner.

Optional authentication accepts a missing token, but rejects an invalid supplied
token with 401. Details and playback allow public/unlisted streams to guests;
private streams are available only to their actual owner. Management permissions
do not override viewing visibility. Public cards include only public content.

`visibility` controls who can access content. `playback_policy` controls whether
Mux media requires a signed token. A public stream can have signed playback and
still be watched by guests through the playback route.

## 1. Create a livestream — POST /

Creates the Mux live stream and the database livestream. No recording video is
created yet; Mux asset webhooks create recordings when streaming starts.

New livestreams explicitly set `new_asset_settings.video_quality: "plus"` and
`new_asset_settings.max_resolution_tier: "1080p"`. Recordings inherit this quality
configuration. These are server settings, not accepted request-body fields.
This applies to newly created streams; existing Mux streams are not modified.
The resolution is a ceiling, not a guarantee that lower-resolution input becomes
1080p. See [Mux quality settings](https://www.mux.com/docs/guides/use-video-quality-levels)
and the [creation API](https://www.mux.com/docs/api-reference/video/live-streams/create-live-stream).

For the encoder, configure OBS separately for 1920×1080 output, 30 FPS,
5,000 kbps video bitrate and a 2-second keyframe interval, following
[Mux's encoder recommendations](https://www.mux.com/docs/guides/configure-broadcast-software).
The backend does not control OBS resolution, bitrate or FPS.

Accepts a JSON body:

| Field | Type | Required/default | Validation |
| --- | --- | --- | --- |
| `title` | string | Required | Trimmed, 1–512 characters |
| `description` | string or null | null | Trimmed when a string |
| `dvr_enabled` | boolean | false | Cannot be changed after creation |
| `scheduled_at` | ISO timestamp or null | null | Must include a timezone; no future-only validation |
| `visibility` | string | `public` | `public`, `unlisted`, `private` |
| `playback_policy` | string | `signed` | `public`, `signed` |

Unknown body fields are rejected. Ownership comes from the access token.

```json
{
  "title": "Live workshop",
  "description": "Questions and answers",
  "dvr_enabled": true,
  "scheduled_at": "2026-10-01T18:00:00Z",
  "visibility": "public",
  "playback_policy": "signed"
}
```

Returns HTTP 201:

```json
{
  "success": true,
  "live_stream": { "id": "<livestream UUID>", "title": "Live workshop", "status": "scheduled", "mux_status": "idle" },
  "stream_key": "<encoder key>",
  "max_continuous_duration": 14399
}
```

The `live_stream` above is abbreviated: creation currently returns the entire
inserted database row. It contains all fields in the management model below,
plus `mux_live_stream_id`, `mux_live_playback_id`, `mux_event_at`,
`mux_active_asset_id`, `mux_session_ended_at`, `mux_deleted_asset_ids`, and
`mux_playback_id_pending_deletion`. Nullable session fields initially contain
null; `mux_deleted_asset_ids` is initially an empty array.

The configured maximum duration is **14,399 seconds** with DVR and **43,200
seconds** without DVR. This response includes the stream key but not the server
URL. Use streaming-details for both. Cache-Control: `no-store`.

Specific errors: 400 invalid input; 502 Mux creation failure or incomplete response.

## 2. List my livestreams — GET /my/lives

Lists all of the authenticated user's livestreams, across visibility and lifecycle
states. Accepts no body.

| Query parameter | Accepted values | Default |
| --- | --- | --- |
| `page` | Positive integer | 1 |
| `limit` | Integer from 1 to 100 | 20 |
| `sort_by` | `created_at`, `scheduled_at`, `started_at`, `updated_at`, `title`, `status`, `visibility` | `created_at` |
| `sort_dir` | `asc`, `desc` | `desc`, unless `sort=old` |
| `sort` | `new`, `old` | Optional shorthand: new = descending, old = ascending |

Explicit `sort_dir` overrides `sort`. Null sort values come last; IDs break ties.
Example: `/my/lives?page=1&limit=20&sort_by=scheduled_at&sort_dir=asc`.

```json
{
  "success": true,
  "live_streams": [],
  "page": 1,
  "limit": 20,
  "total": 0,
  "total_pages": 0,
  "sort_by": "scheduled_at",
  "sort_dir": "asc"
}
```

Each item uses the management model below. It contains no recording, encoder
credentials or Mux resource IDs. A page beyond the result set returns an empty
array while preserving `total`. Specific errors: 400 invalid pagination/sorting.

## 3. Public cards for a user — GET /users/:userId/cards

Returns a unified, paginated list of a user's public livestream content. The
path `userId` identifies the content owner, not the requesting viewer. No body.

| Query parameter | Accepted values | Default |
| --- | --- | --- |
| `page` | Positive integer | 1 |
| `limit` | Integer from 1 to 100 | 20 |
| `sort_by` | `streamed_at`, `views`, `view_count` | `streamed_at` |
| `sort_dir` | `asc`, `desc` | `desc` |

`views` and `view_count` are aliases. Example:
`/users/<user UUID>/cards?sort_by=views&sort_dir=desc&page=1&limit=20`.

Only public parent livestreams qualify. The list includes:

- `recording`: each public, ready recording with `published_at <= now()`.
- `scheduled`: a scheduled livestream with no recording rows at all.
- `live`: one card for each currently live livestream, including when it has a
  preparing recording. It can coexist with eligible recording cards.

No independent card is created for disconnected, ended or cancelled streams,
although their eligible recordings can still appear. Recording eligibility does
not additionally require `recording_completed_at` to be set.

Returns `{ success, cards, page, limit, total, total_pages, sort_by, sort_dir }`.
Each card contains:

```text
id, video_id, livestream_id, card_type,
title, description, thumbnail_url,
uploader_id, uploader_name, people: [{ id, name, image_url }],
duration_seconds, view_count, created_at, streamed_at,
livestream_status, scheduled_at, started_at, ended_at, dvr_enabled,
recording_started_at, recording_completed_at,
mux_thumbnail_url, preview_url, media_expires_at
```

Authenticated responses additionally include `progress_seconds` and
`percentage_watched`; these are populated only for recording cards.

For recording cards, `id` and `video_id` are the video UUID. For live/scheduled
cards, `id` is the livestream UUID. A live card's `video_id` identifies the
current unfinished, non-deleted recording matched to the active Mux asset, or
null. Scheduled cards have null `video_id`. Always use `card_type` to choose the
frontend card UI, since a live card may also contain a video ID.

Live/scheduled cards have zero views, null duration, empty `people`, and null
Mux image/preview fields. Their custom thumbnail remains available. Recording
cards get normal video card media; signed image expiry is Unix seconds.

Time sorting falls back from recording start to live start/connection, schedule,
then creation. View sorting uses that time and IDs as tie-breakers. `total`
counts cards, so it can exceed the number of livestreams. An unknown user with
no qualifying content returns an empty list. Specific errors: 400 invalid input;
503 unavailable signed image configuration.

## 4. Update livestream details — PATCH /:liveStreamId

Accepts a partial JSON object with at least one of:

```json
{
  "title": "Updated workshop",
  "description": null,
  "scheduled_at": "2026-10-01T19:00:00Z",
  "visibility": "unlisted",
  "playback_policy": "public"
}
```

The validation rules match creation for these fields. Null clears description or
schedule. Omitted fields stay unchanged. `dvr_enabled`, status, thumbnail fields,
and all other unknown fields are rejected.

Changing playback policy creates a new Mux live playback ID, saves it, then
deletes the old ID. Existing recordings retain their metadata and playback
policy; future recordings inherit the current livestream settings.

Returns `{ success: true, live_stream: { ... } }`. The returned object contains
the management model below plus `mux_live_stream_id` and `mux_live_playback_id`.
It does not contain a stream key, current recording, or pending-cleanup field.

Specific errors: 400 invalid/empty body; 502 Mux playback replacement/cleanup
failure. A cleanup error can occur after the new policy was saved; retry the
request to finish removing the previous playback ID.

## 5. Set or clear thumbnail — POST /:liveStreamId/thumbnail

Accepts multipart form-data with one `file` field: JPEG, PNG or WebP, maximum
5 MiB (5,242,880 bytes). The server converts it to a 1280×720 WebP and uploads it
to R2. Call this same route without a file to remove the thumbnail.

Recordings whose `mux_status` is `preparing` also receive separate R2 copies of
the new image, or have their thumbnails cleared on removal. Recordings in other
states retain their current thumbnails. Replaced R2 objects are cleaned up after
the database updates commit.

```json
{
  "success": true,
  "live_stream": {
    "id": "<livestream UUID>",
    "thumbnail_url": "https://<R2 host>/live-stream-thumbnails/<id>/<file>.webp"
  }
}
```

Removal returns the same shape with `thumbnail_url: null`. Specific errors:
400 invalid/oversized file or invalid upload; 500 storage configuration/upload
or database failure. Cleanup of old objects is best-effort after a successful save.

## 6. Encoder credentials — GET /:liveStreamId/streaming-details

Returns the RTMPS server and current stream key for OBS or another encoder.
Accepts only the livestream UUID in the path; no body or query parameters.

```json
{
  "success": true,
  "server": "rtmps://global-live.mux.com:443/app",
  "stream_key": "<current encoder key>"
}
```

Works before a recording exists and during a reconnect window. Specific errors:
409 ended/cancelled livestream or disabled Mux stream; 404 missing Mux stream;
502 Mux lookup failure or missing key. These are broadcasting credentials, not
the viewer playback URL.

## 7. Viewer playback — POST /:liveStreamId/playback

Accepts only the livestream UUID in the path; no request body or query parameters.
Returns the correct HLS playback for the stream's DVR configuration.

- Non-DVR: uses the livestream playback ID and its policy.
- DVR: uses the current unfinished recording's playback ID and its own policy.
  It never falls back to an older recording or non-DVR playback.

The application status must be `live` or `disconnected`, and `mux_status` must
be `active`. For DVR, the current recording must be `preparing` or `ready` with
a playback ID. Scheduled or finished streams do not play through this route;
finished recordings use the video playback endpoint.

```json
{
  "success": true,
  "livestream_id": "<livestream UUID>",
  "video_id": "<current recording UUID>",
  "status": "live",
  "dvr_enabled": true,
  "playback_mode": "dvr",
  "playback_source": "asset",
  "mux_playback_id": "<playback ID>",
  "playback_policy": "signed",
  "stream_url": "https://stream.mux.com/<playback ID>.m3u8?token=<JWT>",
  "tokens": { "playback": "<JWT>", "thumbnail": "<JWT>", "storyboard": "<JWT>" },
  "expires_at": 1790877600
}
```

For non-DVR, `playback_mode` is `live` and `playback_source` is `live_stream`.
`video_id` can be null when no usable current recording row exists. For public
playback, the URL has no token, `tokens` is `{}`, and `expires_at` is null.
Signed tokens last one hour; `expires_at` is Unix seconds. Refresh by calling
this route again. Guests with viewing access can receive signed playback too.

Specific errors: 404 missing/inaccessible stream; 409 stream not playable or
current playback not ready; 503 invalid policy or missing signing configuration.

## 8. Livestream details — GET /:liveStreamId

Accepts only the livestream UUID in the path; no body or query parameters.
Returns metadata for any lifecycle state, and the current recording when one
exists. Does not increment views or return playback URLs/encoder credentials.

Returns `{ success: true, live_stream: { ... } }`. The object includes all fields
in the management model below except `user_id`, plus:

```text
uploader_id, uploader_name, uploader_image,
video_id, current_recording
```

`video_id` and `current_recording` are null unless the livestream is `live` or
`disconnected` and has a matching unfinished, non-deleted recording for the
active Mux asset. Preparing/unpublished recordings are included using the
livestream's visibility. A previous recording is never substituted.

When present, `current_recording` has these fields:

```text
id, livestream_id, title, description, thumbnail_url,
mux_status, visibility, playback_policy, duration_seconds,
view_count, like_count, dislike_count, comment_count,
created_at, updated_at, published_at,
recording_started_at, recording_completed_at,
progress_seconds, percentage_watched, user_reaction
```

`user_reaction` is 1 for like, -1 for dislike, or 0 for no reaction. Guests get 0
and null watch progress. Deleted comments and replies to deleted parents do not
count toward `comment_count`. Specific errors: 404 missing/inaccessible stream.

## 9. Delete livestream and recordings — DELETE /:liveStreamId

Accepts only the livestream UUID in the path; no body or query parameters.
Disables ingest, requests deletion of its Mux recording assets and live stream,
removes the managed livestream/recording thumbnail objects from R2, and deletes
the database livestream. Its recordings and dependent database records cascade.

Already missing Mux resources do not prevent local deletion. The request accepts
Mux's asynchronous deletion acknowledgement and does not wait for a deletion
webhook. Other Mux/R2 failures preserve local records so cleanup can be retried;
some remote resources may already have been removed before a failure.

```json
{
  "success": true,
  "live_stream_id": "<livestream UUID>",
  "message": "Live stream and recordings deleted."
}
```

Specific errors: 404 missing livestream; 502 Mux or R2 cleanup failure; 500
storage configuration/database failure. Repeating deletion after successful
local removal returns 404.

## Management livestream model

The following fields appear on each `/my/lives` item and in PATCH responses:

```text
id, user_id, title, description, thumbnail_url,
status, mux_status, visibility, playback_policy, dvr_enabled,
scheduled_at, started_at, ended_at,
connected_at, disconnected_at, completed_at,
created_at, updated_at
```

The application lifecycle uses `scheduled`, `live`, `disconnected`, `ended`, and
`cancelled`. Mux status is `idle`, `active`, or `disabled`. Description, thumbnail,
schedule and lifecycle dates may be null. `created_at` and `updated_at` are set.
Creation/PATCH/details add or replace fields as specified in their sections.

## Common errors and caching

| HTTP status | Meaning |
| --- | --- |
| 400 | Invalid UUID, body, pagination, sorting or upload |
| 401 | Missing required authentication, invalid token or inactive account |
| 403 | Missing management permission or insufficient resource access |
| 404 | Resource missing, or hidden by viewer visibility rules |
| 409 | Stream lifecycle/playback state does not permit the requested operation |
| 500 | Unexpected server/database/storage failure |
| 502 | An upstream operation failed as described for the route |
| 503 | Playback/image signing or policy configuration unavailable |

Handler errors normally return `{ "success": false, "message": "..." }`.
The existing `requirePermission` middleware instead returns
`{ "message": "Insufficient permissions", "requiredPermission": "..." }`.

Creation returns `Cache-Control: no-store`. Successful list, cards, details,
update, streaming-details and playback responses use `private, no-store`.
Thumbnail and deletion controllers do not set an explicit cache header.
