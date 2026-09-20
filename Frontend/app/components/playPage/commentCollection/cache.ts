import type { FetchCommentRepliesT, FetchVideoCommentsT, VideoCommentT } from "~/types";

export const COMMENT_PAGE_SIZE = 20;
export type ReplyPage = { comment: VideoCommentT; pages: number };

export function isThreadOpen(id: string, roots: VideoCommentT[], expanded: Record<string, boolean>, mobileStack: string[], pages: Record<string, ReplyPage>, visibleIds: Set<string>) {
  const visited = new Set<string>();
  let current: string | null = id;
  while (current) {
    if (!visibleIds.has(current) || visited.has(current) || !(expanded[current] || mobileStack.includes(current))) return false;
    visited.add(current);
    const parent: VideoCommentT | undefined = pages[current]?.comment;
    if (!parent) return false;
    if (!parent.parent_id) return roots.some(root => root.id === parent.id);
    current = parent.parent_id;
  }
  return false;
}

export function updateRootPage(current: FetchVideoCommentsT | undefined, transform: (comment: VideoCommentT) => VideoCommentT, created?: VideoCommentT, deleted?: VideoCommentT) {
  if (!current) return current;
  let comments = current.comments.map(transform).filter(comment => comment.id !== deleted?.id);
  const delta = created && !created.parent_id ? 1 : deleted && !deleted.parent_id ? -1 : 0;
  const total = Math.max(0, current.total + delta);
  if (created && !created.parent_id && current.page === 1 && !comments.some(comment => comment.id === created.id)) {
    comments = [created, ...comments];
  }
  return { ...current, comments, total, total_pages: Math.ceil(total / current.limit) };
}

export function updateReplyPage(current: FetchCommentRepliesT | undefined, transform: (comment: VideoCommentT) => VideoCommentT, created?: VideoCommentT, deleted?: VideoCommentT) {
  if (!current) return current;
  let replies = current.replies.map(transform).filter(comment => comment.id !== deleted?.id);
  const delta = created?.parent_id === current.parent_id ? 1 : deleted?.parent_id === current.parent_id ? -1 : 0;
  const total = Math.max(0, current.pagination.total + delta);
  const { page, limit } = current.pagination;

  const totalPages = Math.ceil(total / limit);
  return { ...current, replies, pagination: { ...current.pagination, total, totalPages, hasNextPage: page < totalPages } };
}

export function changeReplyCount(comment: VideoCommentT, parentId: string | null, delta: number): VideoCommentT {
  return comment.id === parentId ? { ...comment, reply_count: Math.max(0, comment.reply_count + delta) } : comment;
}

export function uniqueComments(comments: VideoCommentT[]): VideoCommentT[] {
  return Array.from(new Map(comments.map(comment => [comment.id, comment])).values());
}

export function nextCommentPage(last: FetchVideoCommentsT, pages: FetchVideoCommentsT[]) {
  const loaded = uniqueComments(pages.flatMap(page => page.comments)).length;
  return last.comments.length > 0 && last.page < last.total_pages && loaded < last.total ? last.page + 1 : undefined;
}
