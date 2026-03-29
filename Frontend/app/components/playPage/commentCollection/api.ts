import { fetchFn } from "~/API";
import type { FetchCommentRepliesT, FetchVideoCommentsT, VideoCommentT } from "~/types";

export async function fetchAllComments(videoId: string, headers: Headers): Promise<FetchVideoCommentsT> {
  const firstPage = await fetchFn<FetchVideoCommentsT>({
    route: `api/videos/${videoId}/comments?limit=100&page=1`,
    options: {
      method: "GET",
      headers,
    },
  });

  const totalPages = Math.max(firstPage.total_pages ?? 1, 1);

  if (totalPages === 1) {
    return firstPage;
  }

  const restPages = await Promise.all(
    Array.from({ length: totalPages - 1 }, (_, index) =>
      fetchFn<FetchVideoCommentsT>({
        route: `api/videos/${videoId}/comments?limit=100&page=${index + 2}`,
        options: {
          method: "GET",
          headers,
        },
      })
    )
  );

  const commentsMap = new Map<string, VideoCommentT>();

  for (const comment of firstPage.comments) {
    commentsMap.set(comment.id, comment);
  }

  for (const page of restPages) {
    for (const comment of page.comments) {
      commentsMap.set(comment.id, comment);
    }
  }

  return {
    ...firstPage,
    comments: Array.from(commentsMap.values()),
  };
}

export async function fetchAllReplies(parentId: string, headers: Headers): Promise<FetchCommentRepliesT> {
  const firstPage = await fetchFn<FetchCommentRepliesT>({
    route: `api/comments/${parentId}/replies?limit=100&page=1`,
    options: {
      method: "GET",
      headers,
    },
  });

  const totalPages = Math.max(firstPage.total_pages ?? 1, 1);

  if (totalPages === 1) {
    return firstPage;
  }

  const restPages = await Promise.all(
    Array.from({ length: totalPages - 1 }, (_, index) =>
      fetchFn<FetchCommentRepliesT>({
        route: `api/comments/${parentId}/replies?limit=100&page=${index + 2}`,
        options: {
          method: "GET",
          headers,
        },
      })
    )
  );

  const repliesMap = new Map<string, VideoCommentT>();

  for (const reply of firstPage.replies) {
    repliesMap.set(reply.id, reply);
  }

  for (const page of restPages) {
    for (const reply of page.replies) {
      repliesMap.set(reply.id, reply);
    }
  }

  return {
    ...firstPage,
    replies: Array.from(repliesMap.values()),
  };
}

export async function fetchReplyThread(rootParentId: string, headers: Headers): Promise<FetchCommentRepliesT> {
  const queue = [rootParentId];
  const visitedParents = new Set<string>();
  const repliesMap = new Map<string, VideoCommentT>();
  let videoId = "";

  while (queue.length > 0) {
    const parentId = queue.shift();
    if (!parentId || visitedParents.has(parentId)) continue;

    visitedParents.add(parentId);
    const response = await fetchAllReplies(parentId, headers);
    videoId = response.video_id || videoId;

    for (const reply of response.replies) {
      const alreadySeen = repliesMap.has(reply.id);
      repliesMap.set(reply.id, reply);

      if (!alreadySeen && (reply.reply_count ?? 0) > 0) {
        queue.push(reply.id);
      }
    }
  }

  return {
    success: true,
    parent_id: rootParentId,
    video_id: videoId,
    page: 1,
    limit: 100,
    total: repliesMap.size,
    total_pages: 1,
    replies: Array.from(repliesMap.values()),
  };
}
