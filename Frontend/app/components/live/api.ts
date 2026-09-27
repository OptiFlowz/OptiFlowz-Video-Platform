import { fetchFn } from '~/API';
import { getToken } from '~/functions';
import type { VideoT } from '~/types';

export type LiveStatus = 'scheduled' | 'live' | 'reconnecting' | 'ending' | 'ended' | 'cancelled' | 'errored';
export type Livestream = {
  status: LiveStatus; mode: 'standard' | 'dvr'; scheduled_start_at: string | null;
  started_at: string | null; ended_at: string | null; stop_at: string | null;
  max_duration_seconds: number; recording_finalized_at: string | null; policy_sync_pending?: boolean;
};
export type LiveVideo = VideoT & { kind: 'live'; livestream: Livestream };
export type LiveList = { livestreams: LiveVideo[]; pagination: { page: number; limit: number; total: number } };
export const liveStatuses: LiveStatus[] = ['scheduled', 'live', 'reconnecting', 'ending', 'ended', 'cancelled', 'errored'];
export function liveDeletionBlocked(live: Livestream) {
  return ['live', 'reconnecting', 'ending'].includes(live.status) || !!live.policy_sync_pending;
}
export function liveRequest<T>(route: string, method = 'GET', body?: unknown, signal?: AbortSignal) {
  const token = getToken();
  const headers = new Headers();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (body !== undefined && !(body instanceof FormData)) headers.set('Content-Type', 'application/json');
  return fetchFn<T>({ route: `api/${route}`, options: { method, headers, cache: 'no-store', signal,
    ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }) } });
}
export function recordingReady(video: VideoT) {
  return video.kind !== 'live' || (video.livestream?.status === 'ended' && !!video.livestream.recording_finalized_at && video.playback_available === true);
}
