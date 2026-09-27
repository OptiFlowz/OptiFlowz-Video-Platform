# Livestream schema and route eligibility

Apply migrations `1790467200000`, `1790467200001`, and `1790467200002`
before deploying this backend. Existing videos and direct uploads default to
`videos.kind = 'upload'`. Each broadcast has a `kind = 'live'` video and a
`video_livestreams` child, created in one transaction. A composite foreign key
enforces the parent kind. Finished recordings remain live content.

Title, owner, visibility, publication, thumbnails, comments and reactions are
shared on the video. Recording asset/playback IDs stay on `videos`; live stream
and live playback IDs stay on the child. Standard playback uses the live ID;
DVR and finalized replays use the recording ID.

`published_at` controls page availability; `scheduled_start_at` is planning
metadata. A published scheduled event is visible before its broadcast begins.
`recording_finalized_at` is distinct from initial Mux asset readiness. The
configured DVR duration is strictly below 14,400 seconds. Mux receives a
continuous duration plus reconnect allowance within that budget; the lifecycle
scheduler inside the API enforces the original saved deadline across reconnects.

`policy_sync_pending` blocks playback during incomplete provider policy changes.
`mux_stream_pending_deletion` records provider cleanup after scheduled stream
replacement. `last_connection_event_at` orders connection/disconnection events.
`video_views.is_playing` supports concurrent-viewer estimates.

Shared eligibility is defined in `src/common/videoEligibility.js`: page access,
playable content, and finalized recording actions are separate predicates.
Discovery lists remain upload-only; playlists, post embeds, history and likes
support both kinds. Continue watching and recording actions accept finished
replays. Shared mutation authorization resolves permissions from stored kind.

The ten `livestreams.*` permissions are independent of `videos.*`. Administrator
receives all ten; Uploader receives create/update-own/delete-own/broadcast-own;
Viewer receives library/progress/react. Live analytics has separate own/any
permissions, backfilled from existing video analytics role effects. Explicit
assignments are preserved; platform Owner retains its bypass.

See the [module API and deployment guide](../src/modules/livestreams/README.md)
for routes, payloads, retry behavior and background checks. Run
`npm run test:livestreams` with `TEST_DATABASE_URL` pointing to a local PostgreSQL
test database to exercise isolated temporary-table integration tests. Provider
calls are mocked. Schema rollback refuses to discard existing live content.
