import { fetchFn } from "~/API";
import type { FetchCommentRepliesT, FetchVideoCommentsT } from "~/types";

export function fetchComments(videoId: string, headers: Headers, page: number, limit: number, signal?: AbortSignal, kind: "video" | "post" = "video") {
  return fetchFn<FetchVideoCommentsT>({
    route: `api/${kind === "post" ? "posts" : "videos"}/${videoId}/comments?limit=${limit}&page=${page}`,
    options: { method: "GET", headers, signal },
  });
}

// The endpoint returns direct children. Descendants are requested only when opened.
export function fetchReplies(parentId: string, headers: Headers, page: number, limit: number, signal?: AbortSignal, kind: "video" | "post" = "video") {
  return fetchFn<FetchCommentRepliesT>({
    route: `api/${kind === "post" ? "post-comments" : "comments"}/${parentId}/replies?limit=${limit}&page=${page}`,
    options: { method: "GET", headers, signal },
  });
}
