import { HttpError } from './httpError.js';

// SQL fragments are composed only from server-owned aliases/parameter slots.
export function visibleVideoWhere({ videoAlias = 'v', userParam = '$2', allowLiveRecording = false } = {}) {
  const v = videoAlias;
  const published = `(${v}.mux_status = 'ready'
    AND ((${v}.visibility = 'public' AND ${v}.published_at <= NOW())
      OR (${v}.visibility IN ('public', 'private') AND ${v}.uploaded_by = ${userParam})))`;
  if (!allowLiveRecording) return published;
  // Only the current unfinished asset inherits access from an active stream.
  // Other recordings, drafts and scheduled videos retain publication checks.
  return `(${published} OR (
    ${v}.mux_status IS DISTINCT FROM 'deleted'
    AND ${v}.mux_recording_completed_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.live_streams live_access
      WHERE live_access.id = ${v}.live_stream_id
        AND live_access.mux_active_asset_id = ${v}.mux_asset_id
        AND live_access.status IN ('live', 'disconnected')
        AND (live_access.visibility IN ('public', 'unlisted')
          OR (live_access.visibility = 'private' AND live_access.user_id = ${userParam}))
    )
  ))`;
}

// Call with the primary database for current access state. Live access is
// explicit so video embedding, notes and other callers keep their old rules.
export async function requireVisibleVideo(database, videoId, userId = null, options = {}) {
  const { rows } = await database.query(
    `SELECT v.id FROM public.videos v
     WHERE v.id = $1 AND ${visibleVideoWhere({ allowLiveRecording: options.allowLiveRecording })}`,
    [videoId, userId],
  );
  if (!rows.length) throw new HttpError(404, { message: 'Video not found' });
}
