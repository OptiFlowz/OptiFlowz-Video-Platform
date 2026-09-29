import { useQuery } from '@tanstack/react-query';
import { getToken } from '~/functions';
import { canPlayLive, liveRequest, type LiveDetails, type LivePlayback } from './api';
import { playbackExpiresAt } from '../playback/useVideoPlayback';

export function useLiveDetails(id?: string, enabled = true) {
  const token = getToken();
  return useQuery({
    queryKey: ['live-details', id, token], enabled: enabled && !!id,
    queryFn: async ({ signal }) => (await liveRequest<{ live_stream: LiveDetails }>(`live-streams/${encodeURIComponent(id!)}`, 'GET', undefined, signal)).live_stream,
    staleTime: 0, gcTime: 0,
    retry: (count, error) => count < 1 && ![401, 403, 404].includes(Number((error as { status?: number }).status)),
    refetchInterval: query => query.state.error && [401, 403, 404].includes(Number((query.state.error as { status?: number }).status)) ? false : 10000,
  });
}

export function useLivePlayback(live?: LiveDetails) {
  const token = getToken();
  const available = canPlayLive(live);
  const query = useQuery({
    // A reconnect can start a different recording with its own playback policy.
    queryKey: ['live-playback', live?.id, token, live?.video_id, live?.playback_policy, available],
    enabled: available,
    queryFn: async ({ signal }) => {
      const data = await liveRequest<LivePlayback>(`live-streams/${live!.id}/playback`, 'POST', undefined, signal);
      if (data.livestream_id !== live!.id || !data.stream_url || !data.mux_playback_id ||
          !['live', 'dvr'].includes(data.playback_mode) || !['public', 'signed'].includes(data.playback_policy) ||
          (data.playback_policy === 'signed' && (!data.tokens?.playback || !Number.isFinite(playbackExpiresAt(data.expires_at)) || playbackExpiresAt(data.expires_at) <= Date.now()))) {
        throw new Error('Invalid livestream playback response');
      }
      return data;
    },
    staleTime: 0, gcTime: 0,
    retry: (count, error) => count < 1 && ![401, 403, 404, 409].includes(Number((error as { status?: number }).status)),
    refetchInterval: query => {
      const status = Number((query.state.error as { status?: number } | null)?.status);
      if ([401, 403, 404].includes(status)) return false;
      if (query.state.error || !query.state.data) return 5000;
      return query.state.data.playback_policy === 'signed'
        ? Math.max(1000, Math.min(20 * 60000, playbackExpiresAt(query.state.data.expires_at) - Date.now() - 60000)) : false;
    },
    refetchIntervalInBackground: true,
  });
  const expired = !!query.data && playbackExpiresAt(query.data.expires_at) <= Date.now();
  const denied = [401, 403, 404, 409].includes(Number((query.error as { status?: number } | null)?.status));
  return { ...query, data: !available || expired || denied ? undefined : query.data, isError: query.isError || expired };
}
