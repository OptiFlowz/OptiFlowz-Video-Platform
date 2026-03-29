import type {
  CommentReactionResponseT,
  FetchCommentRepliesT,
  FetchVideoCommentsT,
  VideoCommentT,
} from "~/types";
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

function updateCommentReaction(
  comment: VideoCommentT,
  reaction: "like" | "dislike",
  response: CommentReactionResponseT
): VideoCommentT {
  const nextReaction =
    reaction === "like"
      ? comment.my_reaction === 1
        ? null
        : 1
      : comment.my_reaction === -1
        ? null
        : -1;

  return {
    ...comment,
    like_count: response.like_count,
    dislike_count: response.dislike_count,
    my_reaction: nextReaction,
  };
}

export function updateCommentsCache(
  current: FetchVideoCommentsT | undefined,
  commentId: string,
  reaction: "like" | "dislike",
  response: CommentReactionResponseT
) {
  if (!current) return current;

  return {
    ...current,
    comments: current.comments.map((comment) =>
      comment.id === commentId ? updateCommentReaction(comment, reaction, response) : comment
    ),
  };
}

export function updateRepliesCache(
  current: FetchCommentRepliesT | undefined,
  commentId: string,
  reaction: "like" | "dislike",
  response: CommentReactionResponseT
) {
  if (!current) return current;

  return {
    ...current,
    replies: current.replies.map((reply) =>
      reply.id === commentId ? updateCommentReaction(reply, reaction, response) : reply
    ),
  };
}

export function findRootParentId(commentId: string | null | undefined, commentsMap: Map<string, VideoCommentT>) {
  if (!commentId) return null;

  let currentId: string | null = commentId;
  let guard = 0;

  while (currentId && guard < 200) {
    const currentComment = commentsMap.get(currentId);
    if (!currentComment?.parent_id) {
      return currentId;
    }

    currentId = currentComment.parent_id;
    guard += 1;
  }

  return currentId;
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

export function appendReplyToCache(current: FetchCommentRepliesT | undefined, reply: VideoCommentT) {
  if (!current) {
    return {
      success: true,
      parent_id: reply.parent_id ?? "",
      video_id: reply.video_id,
      page: 1,
      limit: 100,
      total: 1,
      total_pages: 1,
      replies: [reply],
    };
  }

  const replies = current.replies.some((item) => item.id === reply.id)
    ? current.replies
    : [...current.replies, reply];

  return {
    ...current,
    total: Math.max(current.total, replies.length),
    total_pages: Math.max(current.total_pages, 1),
    replies,
  };
}

export function getDeletedReplyIds(
  current: FetchCommentRepliesT | undefined,
  deletedCommentId: string
) {
  const deletedIds = new Set<string>([deletedCommentId]);

  if (!current) {
    return deletedIds;
  }

  let changed = true;
  while (changed) {
    changed = false;

    for (const reply of current.replies) {
      if (reply.parent_id && deletedIds.has(reply.parent_id) && !deletedIds.has(reply.id)) {
        deletedIds.add(reply.id);
        changed = true;
      }
    }
  }

  return deletedIds;
}

export function updateCommentsAfterSubmit(
  current: FetchVideoCommentsT | undefined,
  comment: VideoCommentT,
  rootParentId?: string | null
) {
  if (!current) {
    return {
      comments: [comment],
      page: 1,
      limit: 100,
      total: 1,
      total_pages: 1,
    };
  }

  if (!comment.parent_id) {
    const comments = current.comments.some((item) => item.id === comment.id)
      ? current.comments
      : [comment, ...current.comments];

    return {
      ...current,
      total: current.total + (comments.length === current.comments.length ? 0 : 1),
      comments,
    };
  }

  return {
    ...current,
    comments: current.comments.map((item) =>
      item.id === rootParentId
        ? { ...item, reply_count: Math.max((item.reply_count ?? 0) + 1, 1) }
        : item
    ),
  };
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

function updateCommentContent(comment: VideoCommentT, nextComment: VideoCommentT): VideoCommentT {
  if (comment.id !== nextComment.id) return comment;

  return {
    ...comment,
    ...nextComment,
    content: nextComment.content,
    updated_at: nextComment.updated_at ?? new Date().toISOString(),
  };
}

export function updateEditedCommentInCommentsCache(
  current: FetchVideoCommentsT | undefined,
  nextComment: VideoCommentT
) {
  if (!current) return current;

  return {
    ...current,
    comments: current.comments.map((comment) => updateCommentContent(comment, nextComment)),
  };
}

export function updateEditedCommentInRepliesCache(
  current: FetchCommentRepliesT | undefined,
  nextComment: VideoCommentT
) {
  if (!current) return current;

  return {
    ...current,
    replies: current.replies.map((reply) => updateCommentContent(reply, nextComment)),
  };
}

export function removeCommentFromCommentsCache(
  current: FetchVideoCommentsT | undefined,
  deletedComment: VideoCommentT,
  rootParentId?: string | null,
  removedRepliesCount = 1
) {
  if (!current) return current;

  if (!deletedComment.parent_id) {
    const comments = current.comments.filter((comment) => comment.id !== deletedComment.id);

    return {
      ...current,
      total: Math.max(current.total - (comments.length === current.comments.length ? 0 : 1), 0),
      comments,
    };
  }

  return {
    ...current,
    comments: current.comments.map((comment) =>
      comment.id === rootParentId
        ? { ...comment, reply_count: Math.max((comment.reply_count ?? removedRepliesCount) - removedRepliesCount, 0) }
        : comment
    ),
  };
}

export function removeCommentFromRepliesCache(
  current: FetchCommentRepliesT | undefined,
  deletedComment: VideoCommentT
) {
  if (!current) return current;

  const deletedIds = getDeletedReplyIds(current, deletedComment.id);

  return {
    ...current,
    total: Math.max(current.total - deletedIds.size, 0),
    replies: current.replies.filter((reply) => !deletedIds.has(reply.id)),
  };
}

export function buildRepliesTree(
  sortedParents: VideoCommentT[],
  repliesByParent: Record<string, VideoCommentT[]>
) {
  const treeMap: Record<string, CommentTreeNode[]> = {};

  for (const parent of sortedParents) {
    const replies = repliesByParent[parent.id] ?? [];
    if (replies.length === 0) {
      treeMap[parent.id] = [];
      continue;
    }

    const nodes = new Map<string, CommentTreeNode>();
    const roots: CommentTreeNode[] = [];

    for (const reply of replies) {
      nodes.set(reply.id, { ...reply, children: [] });
    }

    for (const reply of replies) {
      const node = nodes.get(reply.id);
      if (!node) continue;

      if (reply.parent_id === parent.id) {
        roots.push(node);
        continue;
      }

      const parentNode = reply.parent_id ? nodes.get(reply.parent_id) : null;
      if (parentNode) {
        parentNode.children.push(node);
      } else {
        roots.push(node);
      }
    }

    treeMap[parent.id] = roots;
  }

  return treeMap;
}

export function countUniqueComments(sortedParents: VideoCommentT[], repliesByParent: Record<string, VideoCommentT[]>) {
  const uniqueIds = new Set<string>();

  for (const parent of sortedParents) {
    uniqueIds.add(parent.id);
  }

  for (const replies of Object.values(repliesByParent)) {
    for (const reply of replies) {
      uniqueIds.add(reply.id);
    }
  }

  return uniqueIds.size;
}

export function isCommentOwnedByUser(comment: VideoCommentT, currentUserId: string, currentUserName: string) {
  return comment.user_id === currentUserId || comment.author_full_name === currentUserName;
}

export function canDeleteComment(
  comment: VideoCommentT,
  currentUserId: string,
  currentUserName: string,
  isAdmin: boolean
) {
  return isAdmin || isCommentOwnedByUser(comment, currentUserId, currentUserName);
}
