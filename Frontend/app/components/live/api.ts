import { fetchFn } from '~/API';
import { getToken } from '~/functions';

export type LiveStatus = 'scheduled' | 'live' | 'disconnected' | 'ended' | 'cancelled';
export type LiveStream = {
  id: string; user_id: string; title: string; description: string | null; thumbnail_url: string | null;
  status: LiveStatus; mux_status: 'idle' | 'active' | 'disabled';
  visibility: 'public' | 'unlisted' | 'private'; playback_policy: 'public' | 'signed'; dvr_enabled: boolean;
  scheduled_at: string | null; started_at: string | null; ended_at: string | null;
  connected_at: string | null; disconnected_at: string | null; completed_at: string | null;
  created_at: string; updated_at: string;
};
export type LiveRecording = {
  id: string; livestream_id: string; title: string; description: string | null; thumbnail_url: string | null;
  mux_status: string; visibility: LiveStream['visibility']; playback_policy: LiveStream['playback_policy'];
  duration_seconds: number | null; view_count: number; like_count: number; dislike_count: number; comment_count: number;
  created_at: string; updated_at: string; published_at: string | null;
  recording_started_at: string | null; recording_completed_at: string | null;
  progress_seconds: number | null; percentage_watched: number | null; user_reaction: number;
};
export type LiveDetails = Omit<LiveStream, 'user_id'> & {
  uploader_id: string; uploader_name: string; uploader_image: string | null;
  video_id: string | null; current_recording: LiveRecording | null;
};
export type LiveCard = {
  id: string; video_id: string | null; livestream_id: string; card_type: 'recording' | 'scheduled' | 'live';
  title: string; description: string | null; thumbnail_url: string | null; uploader_id: string; uploader_name: string;
  people: { id: string; name: string; image_url: string | null }[];
  duration_seconds: number | null; view_count: number; created_at: string; streamed_at: string | null;
  livestream_status: LiveStatus; scheduled_at: string | null; started_at: string | null; ended_at: string | null;
  dvr_enabled: boolean; recording_started_at: string | null; recording_completed_at: string | null;
  mux_thumbnail_url: string | null; preview_url: string | null; media_expires_at: number | null;
  progress_seconds?: number | null; percentage_watched?: number | null;
};
type Page = { page: number; limit: number; total: number; total_pages: number; sort_by: string; sort_dir: string };
export type LiveListResponse = Page & { live_streams: LiveStream[] };
export type LiveCardsResponse = Page & { cards: LiveCard[] };
export type LivePlayback = {
  livestream_id: string; video_id: string | null; status: LiveStatus; dvr_enabled: boolean;
  playback_mode: 'live' | 'dvr'; playback_source: 'asset' | 'live_stream'; mux_playback_id: string;
  playback_policy: 'public' | 'signed'; stream_url: string;
  tokens: { playback?: string; thumbnail?: string; storyboard?: string }; expires_at: number | null;
};
export function liveRequest<T>(route: string, method = 'GET', body?: unknown, signal?: AbortSignal) {
  const token = getToken();
  const headers = new Headers();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (body !== undefined && !(body instanceof FormData)) headers.set('Content-Type', 'application/json');
  return fetchFn<T>({ route: `api/${route}`, options: { method, headers, cache: 'no-store', signal,
    ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }) } });
}
export const liveStatusKey = (status: LiveStatus) => status === 'disconnected' ? 'reconnecting' : status;
export const canPlayLive = (live?: LiveDetails) => !!live && ['live', 'disconnected'].includes(live.status) && live.mux_status === 'active';
