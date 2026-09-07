import { useQuery } from "@tanstack/react-query";
import { fetchFn } from "~/API";
import { getToken } from "~/functions";

export type PlaybackPolicy = "public" | "signed";
export type VideoPlayback = {
  video_id: string;
  mux_playback_id: string;
  playback_policy: PlaybackPolicy;
  stream_url: string;
  tokens: { playback?: string; thumbnail?: string; storyboard?: string };
  expires_at: string | number | null;
};

export function playbackExpiresAt(value: VideoPlayback["expires_at"]): number {
  if (value == null) return Infinity;
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  if (/^\d+(\.\d+)?$/.test(value)) return playbackExpiresAt(Number(value));
  return Date.parse(value);
}

export function useVideoPlayback(videoId?: string, enabled = true) {
  const token = getToken();
  const query = useQuery({
    queryKey: ["video-playback", videoId, token],
    enabled: enabled && !!videoId,
    queryFn: async ({ signal }) => {
      const data = await fetchFn<VideoPlayback>({
        route: `api/videos/${encodeURIComponent(videoId!)}/playback`,
        options: { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: "no-store", signal },
      });
      if (!data?.stream_url || !data.mux_playback_id || data.video_id !== videoId ||
          !["public", "signed"].includes(data.playback_policy) ||
          (data.playback_policy === "signed" && (!Number.isFinite(playbackExpiresAt(data.expires_at)) || playbackExpiresAt(data.expires_at) <= Date.now()))) {
        throw new Error("Invalid playback response");
      }
      return data;
    },
    staleTime: 0,
    gcTime: 0,
    retry: (count, error) => count < 2 && ![401, 403, 404].includes(Number((error as { status?: number }).status)),
    refetchOnWindowFocus: true,
    refetchInterval: ({ state }) => state.data?.playback_policy === "signed"
      ? Math.max(1000, Math.min(20 * 60_000, playbackExpiresAt(state.data.expires_at) - Date.now() - 60_000))
      : false,
    refetchIntervalInBackground: true,
  });
  const expired = query.data ? playbackExpiresAt(query.data.expires_at) <= Date.now() : false;
  const denied = [401, 403, 404].includes(Number((query.error as { status?: number } | null)?.status));
  return { ...query, data: expired || denied ? undefined : query.data, isError: query.isError || expired };
}
