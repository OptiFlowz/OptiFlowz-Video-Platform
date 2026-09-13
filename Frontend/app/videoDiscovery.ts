import { fetchFn } from "~/API";

type VideoResults = { videos: unknown[] };
type Request = Parameters<typeof fetchFn>[0];
export type RecommendationResult<T> = T & { hasWatchHistory?: boolean };

/** Keep the original query string and response metadata for either search source. */
export async function fetchVectorVideos<T extends VideoResults>(request: Request): Promise<T> {
  const queryStart = request.route.indexOf("?");
  const path = queryStart < 0 ? request.route : request.route.slice(0, queryStart);
  const query = queryStart < 0 ? "" : request.route.slice(queryStart);

  // Browsing by category, tag or person (and sitemap enumeration) needs no embedding.
  if (path === "api/videos/search" && !new URLSearchParams(query).get("q")?.trim()) {
    return fetchFn<T>(request);
  }

  const result = await fetchFn<T>({ ...request, route: `${path}/vector${query}` });
  if (result.videos.length > 0) return result;

  // Do not turn cancellation or HTTP errors into a second request.
  request.options.signal?.throwIfAborted();
  return fetchFn<T>(request);
}

export async function fetchRecommendedVideos<T extends VideoResults>(request: Request): Promise<RecommendationResult<T>> {
  const result = await fetchVectorVideos<T>(request);
  if (result.videos.length > 0) return result;

  request.options.signal?.throwIfAborted();
  const history = await fetchFn<VideoResults>({
    route: "api/videos/user/history?page=1&limit=1",
    options: request.options,
  });
  return { ...result, hasWatchHistory: history.videos.length > 0 };
}
