import { fetchFn } from "~/API";
import type { FetchCommentRepliesT, FetchVideoCommentsT } from "~/types";

export function fetchComments(videoId: string, headers: Headers, page: number, limit: number, signal?: AbortSignal) {
  return fetchFn<FetchVideoCommentsT>({
    route: `api/videos/${videoId}/comments?limit=${limit}&page=${page}`,
    options: { method: "GET", headers, signal },
  });
}

// The endpoint returns direct children. Descendants are requested only when opened.
export function fetchReplies(parentId: string, headers: Headers, page: number, limit: number, signal?: AbortSignal) {
  return fetchFn<FetchCommentRepliesT>({
    route: `api/comments/${parentId}/replies?limit=${limit}&page=${page}`,
    options: { method: "GET", headers, signal },
  });
}
