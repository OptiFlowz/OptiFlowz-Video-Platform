# Scheduled video publishing

Publication uses the existing `videos.published_at` (`timestamptz`) column.
No migration or publishing worker is required. A public video becomes available
on the first request where the database time reaches its publication time,
provided Mux reports it as ready:

```sql
visibility = 'public' AND mux_status = 'ready' AND published_at <= NOW()
```

## Schedule and edit

Use the existing video update endpoint and permissions:

```http
PATCH /api/video-moderation/video-details/:videoId
Content-Type: application/json

{
  "visibility": "public",
  "published_at": "2030-09-20T18:00:00+02:00"
}
```

`published_at` accepts an ISO timestamp with `Z` or a numeric timezone offset, or
`null`. Local timestamps without an offset and invalid dates return 400. The
frontend should convert the chosen local date/time to an explicit instant; it
can format the returned timestamp in the user's timezone.

- Reschedule: send another `published_at`; an already-public video becomes
  hidden again if moved into the future.
- Publish now: send `visibility: "public"` and an explicit current timestamp.
  A past timestamp is also accepted.
- Cancel to draft: send `published_at: null`; public visibility alone does not
  expose a video with no publication timestamp.
- Make private: send `visibility: "private"`; this clears the timestamp.
  Sending private visibility together with a non-null publication date is rejected.
- Sending only `visibility: "public"` preserves a saved publication timestamp
  or assigns `NOW()` if none exists, preserving the existing publish action.
- Omitting both publication fields preserves the current state. Updating only
  `published_at` does not change visibility; private videos remain private.

Video details and My Videos return `published_at`. My Videos includes drafts,
scheduled videos, and published videos. Uploaders can preview their own ready
videos before publication through details/playback and notes/comments.

Public listings, recommendations, channel videos, playlist video lists/counts,
people video counts, and public-only reports exclude future and null publication
dates. Playlist fallback artwork skips unavailable videos. Playback and media
authorization use the primary database, including after a schedule is changed.
Existing no-store response headers remain in use for media-bearing endpoints.

If encoding finishes late, the video becomes available once Mux marks it ready.
`published_at` represents the intended availability time, not an audit of when
encoding finished or when someone first requested the video.

## Media protection

These rules control access through the backend. Use Mux `signed` playback (the
upload default) when the media itself must remain inaccessible before release.
An existing Mux public playback URL works independently of the backend. Already
issued signed URLs remain usable until their token expires; rescheduling does
not revoke those URLs. Owner previews should not be shared before publication.

## Verification

```sh
node --experimental-test-module-mocks --test tests/*.test.js
```

The optional PostgreSQL integration test uses `TEST_DATABASE_URL` and only
connection-local temporary tables, without changing application data:

```sh
node --experimental-test-module-mocks --test tests/video-publishing-db.test.js
```
