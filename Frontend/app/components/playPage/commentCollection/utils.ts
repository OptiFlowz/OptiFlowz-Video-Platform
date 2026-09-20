import type { VideoCommentT } from "~/types";
import { getCurrentLocale } from "~/i18n";
import type { CommentTreeNode } from "./types";

export function timeAgo(iso: string) {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.round((now - then) / 1000);

  const locale = getCurrentLocale() === "sr" ? "sr-Latn-RS" : getCurrentLocale();
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  const abs = Math.abs(diffSec);
  const minute = 60;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (abs < minute) return rtf.format(-diffSec, "second");
  if (abs < hour) return rtf.format(-Math.round(diffSec / minute), "minute");
  if (abs < day) return rtf.format(-Math.round(diffSec / hour), "hour");
  return rtf.format(-Math.round(diffSec / day), "day");
}

export function getAncestorChain(commentId: string | null | undefined, commentsMap: Map<string, VideoCommentT>) {
  const chain: string[] = [];
  let currentId = commentId ?? null;
  let guard = 0;

  while (currentId && guard < 200) {
    chain.push(currentId);
    const currentComment = commentsMap.get(currentId);
    currentId = currentComment?.parent_id ?? null;
    guard += 1;
  }

  return chain.reverse();
}

export function findCommentNode(nodes: CommentTreeNode[], commentId: string): CommentTreeNode | null {
  for (const node of nodes) {
    if (node.id === commentId) {
      return node;
    }

    const childMatch = findCommentNode(node.children, commentId);
    if (childMatch) {
      return childMatch;
    }
  }

  return null;
}

export function normalizeSubmittedComment(
  comment: VideoCommentT,
  currentUserName: string,
  currentUserImage: string
): VideoCommentT {
  const now = new Date().toISOString();

  return {
    ...comment,
    author_full_name: comment.author_full_name || currentUserName,
    author_image_url: comment.author_image_url || currentUserImage || null,
    created_at: comment.created_at || now,
    updated_at: comment.updated_at || comment.created_at || now,
    like_count: comment.like_count ?? 0,
    dislike_count: comment.dislike_count ?? 0,
    reply_count: comment.reply_count ?? 0,
    my_reaction: comment.my_reaction ?? null,
  };
}

export function buildRepliesTree(parents: VideoCommentT[], repliesByParent: Record<string, VideoCommentT[]>) {
  const children = (parent: VideoCommentT, depth: number, ancestors: Set<string>): CommentTreeNode[] =>
    (repliesByParent[parent.id] ?? []).filter(reply => !ancestors.has(reply.id)).map(reply => ({
      ...reply,
      depth,
      replyTargetId: parent.id,
      replyTargetAuthorName: parent.author_full_name,
      children: children(reply, depth + 1, new Set([...ancestors, reply.id])),
    }));
  return Object.fromEntries(parents.map(parent => [parent.id, children(parent, 1, new Set([parent.id]))]));
}

export function isCommentOwnedByUser(comment: VideoCommentT, currentUserId: string, _currentUserName: string) {
  return !!currentUserId && comment.user_id === currentUserId;
}
