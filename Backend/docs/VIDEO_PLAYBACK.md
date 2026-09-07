# Video playback endpoint

`POST /api/videos/:id/playback` needs no request body. Send the application's
`Authorization: Bearer <token>` header for private videos. Public visibility
allows guests; private visibility allows only the uploader, matching the video
details endpoint. Visibility is independent of the Mux playback policy.

Apply the `1788652800000_add-videos-playback-policy.sql` migration before using
the endpoint. For signed playback, configure these backend secrets before
starting the app:

- `MUX_SIGNING_KEY`: the Mux signing key ID.
- `MUX_PRIVATE_KEY`: the base64-encoded PEM private key returned by Mux.

These are separate from Mux API credentials and the application's login JWT
secret. Create the signing key in the same Mux environment as the videos.
See [Mux's signing guide](https://www.mux.com/docs/guides/secure-video-playback).

A signed response has this shape:

```json
{
  "video_id": "video UUID",
  "mux_playback_id": "Mux playback ID",
  "playback_policy": "signed",
  "stream_url": "https://stream.mux.com/PLAYBACK_ID.m3u8?token=JWT",
  "tokens": {
    "playback": "JWT",
    "thumbnail": "JWT",
    "storyboard": "JWT"
  },
  "expires_at": 1788700000
}
```

`expires_at` is a Unix timestamp in seconds: request fresh tokens before this
deadline. The lifetime is at least one hour, or the video's full duration plus
30 minutes, whichever is longer. Each request checks access again. Previously
issued tokens remain usable until they expire.

For Mux Player, use `mux_playback_id` as `playbackId` and pass the `tokens` object
to its `tokens` property. For public playback policies, the endpoint returns an
unsigned stream URL, an empty `tokens` object, and `expires_at: null`; no signing
key is required. Responses use `Cache-Control: private, no-store`. This endpoint
does not increment views and does not accept client-selected playback IDs,
policies, or token lifetimes.

Errors: malformed video ID (`400`), invalid supplied authentication (`401`),
missing/inaccessible video (`404`), video not ready or missing a playback ID
(`409`), missing signing configuration or unsupported policy (`503`), unexpected
database/signing failure (`500`).

Frontend players still need to use tokens for signed playback IDs. Existing
public Mux IDs are not converted or removed.

## Subtitle downloads

The video-moderation subtitle endpoint and the shared VTT downloader used by
subtitle translation and metadata generation read `playback_policy` from the
database. Signed VTT requests include a five-minute JWT with audience `v` using
the same `MUX_SIGNING_KEY` and `MUX_PRIVATE_KEY` secrets as playback. Public VTT
requests remain unsigned. The backend returns the VTT contents; diagnostic URL
headers and response fields omit the internal token. Existing authentication,
video update permissions, and processing responses are preserved.

## Video-card images

Video-card lists now return these fields directly; no preview endpoint is needed:

- `thumbnail_url`: the database value unchanged, including stored Mux URLs or `null`.
- `mux_thumbnail_url`: a Mux thumbnail using `thumbnail_settings`, signed or
  unsigned according to `playback_policy`, or `null` when unavailable.
- `preview_url`: a Mux animated WebP, signed or unsigned, or `null` when unavailable.
- `media_expires_at`: a conservative Unix refresh deadline in seconds for signed
  image URLs (one hour); `null` for public URLs or unavailable Mux media.

Clients display `thumbnail_url || mux_thumbnail_url` and use `preview_url` as
returned. Do not change signed URL parameters. Fetch the existing list again to
refresh expired URLs; list HTTP responses use `Cache-Control: private, no-store`.
Frontend changes are separate: cards should use the returned fields, load
animated images on hover, and retain the thumbnail if a preview fails.
Updated backend list responses include search, trending, history, liked videos,
continue watching, recommendations, the uploader library, channels, playlist
videos, quiz requirements, and top-viewed video cards.

`mux_thumbnail_url` is built independently from the playback ID and saved
`thumbnail_settings`. Missing, null, or empty settings use time 0, width 1280,
height 720, and fit mode `preserve`. Partial settings override individual
defaults. The stored `thumbnail_url` is neither changed nor used to infer these
settings.

Previews start at saved watch progress when available, otherwise halfway through
the video, last up to five seconds, and are clamped to the video duration. Their
width is 640 pixels and frame rate is 10 fps. Signed thumbnails use audience `t`
and previews use `g`, with image parameters inside the JWT claims, following
[Mux's image signing rules](https://www.mux.com/docs/guides/secure-video-playback).

Each list performs one batch read from the primary database to check current
visibility and playback policy before issuing image tokens. Signing does not
make Mux API requests. Configure `MUX_SIGNING_KEY` and `MUX_PRIVATE_KEY` and apply
the playback-policy/thumbnail-settings migrations before serving signed cards.
