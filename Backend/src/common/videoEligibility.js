// SQL aliases are supplied by application code, never request input.
export const recordingReadySql = (v = 'v') => `(${v}.mux_status = 'ready' AND
  (${v}.kind = 'upload' OR EXISTS (SELECT 1 FROM public.video_livestreams lr
    WHERE lr.video_id = ${v}.id AND NOT lr.policy_sync_pending AND lr.status = 'ended' AND lr.recording_finalized_at IS NOT NULL)))`;

export const pageReadySql = (v = 'v') => `(${v}.kind = 'live' OR ${v}.mux_status = 'ready')`;

export const playableSql = (v = 'v') => `(${recordingReadySql(v)} OR
  (${v}.kind = 'live' AND EXISTS (SELECT 1 FROM public.video_livestreams lp
    WHERE lp.video_id = ${v}.id AND lp.status IN ('live', 'reconnecting', 'ending')
      AND NOT lp.policy_sync_pending
      AND (lp.stop_at IS NULL OR lp.stop_at > NOW())
      AND ((lp.mode = 'standard' AND lp.mux_live_playback_id IS NOT NULL)
        OR (lp.mode = 'dvr' AND ${v}.mux_status = 'ready' AND ${v}.mux_playback_id IS NOT NULL)))))`;

export function playbackState(video) {
  const live = video.livestream;
  if (video.kind !== 'live') return video.mux_status === 'ready' && video.mux_playback_id ? 'on-demand' : 'unavailable';
  if (!live || live.policy_sync_pending) return 'unavailable';
  if (live.status === 'ended' && live.recording_finalized_at && video.mux_status === 'ready' && video.mux_playback_id) return 'on-demand';
  if (['live', 'reconnecting', 'ending'].includes(live.status)
    && (!live.stop_at || new Date(live.stop_at).getTime() > Date.now())) {
    if (live.mode === 'standard' && live.mux_live_playback_id) return 'live';
    if (live.mode === 'dvr' && video.mux_status === 'ready' && video.mux_playback_id) return 'live:dvr';
  }
  return 'unavailable';
}

// Explicit public fields: stream credentials and cleanup state never enter cards.
export const livestreamJsonSql = (v = 'v') => `(SELECT json_build_object(
  'mode', l.mode, 'status', l.status, 'policy_sync_pending', l.policy_sync_pending, 'scheduled_start_at', l.scheduled_start_at,
  'started_at', l.started_at, 'ended_at', l.ended_at, 'stop_at', l.stop_at,
  'max_duration_seconds', l.max_duration_seconds, 'recording_finalized_at', l.recording_finalized_at,
  'mux_live_playback_id', l.mux_live_playback_id)
  FROM public.video_livestreams l WHERE l.video_id = ${v}.id)`;
