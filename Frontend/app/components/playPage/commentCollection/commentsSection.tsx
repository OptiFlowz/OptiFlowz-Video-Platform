import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchFn } from "~/API";
import { CloseSVG, CommentSVG } from "~/constants";
import { getStoredUser, getToken, getUserImageUrl, isUserAdmin } from "~/functions";
import type {
  CommentReactionResponseT,
  FetchCommentRepliesT,
  FetchVideoCommentsT,
  PostCommentResponseT,
  VideoCommentT,
} from "~/types";
import DefaultProfile from "../../../../assets/DefaultProfile.webp";
import { ConfirmDialog } from "../../confirmPopup/confirmDialog";
import { useConfirm } from "../../confirmPopup/useConfirm";
import { useI18n } from "~/i18n";
import { fetchAllComments, fetchReplyThread } from "./api";
import CommentComposer from "./commentComposer";
import { CommentThread, MobileCommentThreadView } from "./commentThread";
import type { CommentsSectionProps } from "./types";
import {
  appendReplyToCache,
  buildRepliesTree,
  canDeleteComment,
  countUniqueComments,
  findCommentNode,
  findRootParentId,
  getAncestorChain,
  getDeletedReplyIds,
  isCommentOwnedByUser,
  normalizeSubmittedComment,
  removeCommentFromCommentsCache,
  removeCommentFromRepliesCache,
  updateCommentsAfterSubmit,
  updateCommentsCache,
  updateEditedCommentInCommentsCache,
  updateEditedCommentInRepliesCache,
  updateRepliesCache,
} from "./utils";

function CommentsSection({ videoId, variant = "inline", onClose }: CommentsSectionProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const userProfileImage = getUserImageUrl() || DefaultProfile;
  const token = getToken() ?? "";
  const storedUser = getStoredUser();
  const currentUserName = storedUser?.user?.full_name ?? "";
  const currentUserId = storedUser?.user?.id ?? "";
  const isAdmin = isUserAdmin();

  const [value, setValue] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [replyingTo, setReplyingTo] = useState<VideoCommentT | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(variant !== "drawer");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [mobileThreadStack, setMobileThreadStack] = useState<string[]>([]);
  const [mobileThreadPhase, setMobileThreadPhase] = useState<"idle" | "enter" | "exit">("idle");
  const [mobileThreadDirection, setMobileThreadDirection] = useState<"forward" | "back">("forward");
  const { confirm, dialogProps } = useConfirm();

  const headers = useMemo(() => {
    const nextHeaders = new Headers();
    nextHeaders.set("Content-Type", "application/json");
    if (token) {
      nextHeaders.set("Authorization", `Bearer ${token}`);
    }
    return nextHeaders;
  }, [token]);

  useEffect(() => {
    if (variant !== "drawer") return;
    const frame = requestAnimationFrame(() => setIsDrawerOpen(true));
    return () => cancelAnimationFrame(frame);
  }, [variant]);

  const { data, isLoading, isFetching } = useQuery<FetchVideoCommentsT>({
    queryKey: ["video-comments", videoId],
    queryFn: () => fetchAllComments(videoId, headers),
    enabled: !!videoId && !!token,
    staleTime: 4 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const comments = data?.comments ?? [];
  const parents = useMemo(() => comments.filter((comment) => !comment.parent_id), [comments]);

  const repliesQueries = useQueries({
    queries: parents.map((parent) => ({
      queryKey: ["comment-replies", parent.id],
      queryFn: () => fetchReplyThread(parent.id, headers),
      enabled: !!token,
      staleTime: 4 * 60 * 1000,
      refetchOnWindowFocus: false,
    })),
  });

  const autoResize = () => {
    const element = taRef.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${element.scrollHeight}px`;
  };

  const { repliesByParent, repliesLoadingByParent } = useMemo(() => {
    const nextRepliesByParent: Record<string, VideoCommentT[]> = {};
    const nextRepliesLoadingByParent: Record<string, boolean> = {};

    repliesQueries.forEach((query, index) => {
      const parent = parents[index];
      if (!parent) return;

      nextRepliesByParent[parent.id] = [...(query.data?.replies ?? [])].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      nextRepliesLoadingByParent[parent.id] = !query.data && (query.isLoading || query.isFetching);
    });

    return {
      repliesByParent: nextRepliesByParent,
      repliesLoadingByParent: nextRepliesLoadingByParent,
    };
  }, [parents, repliesQueries]);

  const hydratedCommentsMap = useMemo(() => {
    const map = new Map<string, VideoCommentT>();

    for (const comment of comments) {
      map.set(comment.id, comment);
    }

    for (const replies of Object.values(repliesByParent)) {
      for (const reply of replies) {
        map.set(reply.id, reply);
      }
    }

    return map;
  }, [comments, repliesByParent]);

  const sortedParents = useMemo(() => {
    const nextParents = [...parents];
    nextParents.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return nextParents;
  }, [parents]);

  const repliesTreeByParent = useMemo(
    () => buildRepliesTree(sortedParents, repliesByParent),
    [repliesByParent, sortedParents]
  );

  const submitMutation = useMutation({
    mutationFn: (payload: { content: string; parent_id?: string }) =>
      fetchFn<PostCommentResponseT>({
        route: "api/comments/post",
        options: {
          method: "POST",
          headers,
          body: JSON.stringify({
            video_id: videoId,
            content: payload.content,
            ...(payload.parent_id ? { parent_id: payload.parent_id } : {}),
          }),
        },
      }),
    onSuccess: ({ comment }, variables) => {
      const normalizedComment = normalizeSubmittedComment(
        comment,
        currentUserName,
        userProfileImage === DefaultProfile ? "" : userProfileImage
      );

      setValue("");
      setReplyingTo(null);

      const parentChain = variables.parent_id ? getAncestorChain(variables.parent_id, hydratedCommentsMap) : [];
      if (parentChain.length > 0) {
        setExpanded((prev) => ({
          ...prev,
          ...Object.fromEntries(parentChain.map((id) => [id, true])),
        }));
      }

      autoResize();
      queryClient.setQueryData<FetchVideoCommentsT>(["video-comments", videoId], (current) =>
        updateCommentsAfterSubmit(current, normalizedComment, parentChain[0] ?? null)
      );

      if (normalizedComment.parent_id && parentChain[0]) {
        queryClient.setQueryData<FetchCommentRepliesT>(["comment-replies", parentChain[0]], (current) =>
          appendReplyToCache(current, normalizedComment)
        );
      }
    },
  });

  const reactionMutation = useMutation({
    mutationFn: ({ commentId, reaction }: { commentId: string; reaction: "like" | "dislike" }) =>
      fetchFn<CommentReactionResponseT>({
        route: `api/comments/${commentId}/${reaction}`,
        options: {
          method: "POST",
          headers,
        },
      }),
    onSuccess: (response, variables) => {
      queryClient.setQueryData<FetchVideoCommentsT>(["video-comments", videoId], (current) =>
        updateCommentsCache(current, variables.commentId, variables.reaction, response)
      );
      queryClient.setQueriesData<FetchCommentRepliesT>(
        { queryKey: ["comment-replies"] },
        (current) => updateRepliesCache(current, variables.commentId, variables.reaction, response)
      );
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ commentId, content }: { commentId: string; content: string }) =>
      fetchFn<PostCommentResponseT>({
        route: `api/comments/${commentId}/edit`,
        options: {
          method: "PATCH",
          headers,
          body: JSON.stringify({ content }),
        },
      }),
    onSuccess: ({ comment }) => {
      queryClient.setQueryData<FetchVideoCommentsT>(["video-comments", videoId], (current) =>
        updateEditedCommentInCommentsCache(current, comment)
      );
      queryClient.setQueriesData<FetchCommentRepliesT>(
        { queryKey: ["comment-replies"] },
        (current) => updateEditedCommentInRepliesCache(current, comment)
      );
      setEditingCommentId(null);
      setEditingValue("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (comment: VideoCommentT) =>
      fetchFn<{ success: boolean; deleted: boolean }>({
        route: `api/comments/${comment.id}/delete`,
        options: {
          method: "DELETE",
          headers,
        },
      }),
    onSuccess: (_, comment) => {
      const rootParentId = findRootParentId(comment.parent_id, hydratedCommentsMap);
      const rootReplies = rootParentId
        ? queryClient.getQueryData<FetchCommentRepliesT>(["comment-replies", rootParentId])
        : undefined;
      const removedRepliesCount = comment.parent_id ? getDeletedReplyIds(rootReplies, comment.id).size : 1;

      queryClient.setQueryData<FetchVideoCommentsT>(["video-comments", videoId], (current) =>
        removeCommentFromCommentsCache(current, comment, rootParentId, removedRepliesCount)
      );

      if (rootParentId) {
        queryClient.setQueryData<FetchCommentRepliesT>(["comment-replies", rootParentId], (current) =>
          removeCommentFromRepliesCache(current, comment)
        );
      }

      if (editingCommentId === comment.id) {
        setEditingCommentId(null);
        setEditingValue("");
      }

      if (replyingTo?.id === comment.id) {
        setReplyingTo(null);
      }
    },
  });

  const toggleReplies = (parentId: string) => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 500px)").matches) {
      setMobileThreadDirection("forward");
      setMobileThreadPhase("enter");
      setMobileThreadStack((prev) => [...prev, parentId]);
      return;
    }

    setExpanded((prev) => ({ ...prev, [parentId]: !prev[parentId] }));
  };

  //ENABLE TRACING BACK TO COMMENT
  const [scrollBackTo, setScrollBackTo] = useState<HTMLButtonElement | null>(null);
  const onReply = (comment: VideoCommentT, scrollBackTo: HTMLButtonElement) => {
    setEditingCommentId(null);
    setEditingValue("");
    setReplyingTo(comment);
    setScrollBackTo(scrollBackTo);

    if(scrollBackTo) {
      const lastReplyArray = document.querySelectorAll(".comment-actions button.replying") as NodeListOf<HTMLButtonElement>;

      if(lastReplyArray.length > 0)
        lastReplyArray.forEach(button => {
          if(button !== scrollBackTo)
            // console.log(span);
            button.classList.remove("replying");
        });

      scrollBackTo.classList.add("replying");
    }

    const chain = getAncestorChain(comment.id, hydratedCommentsMap);
    if (chain.length > 0) {
      setExpanded((prev) => ({
        ...prev,
        ...Object.fromEntries(chain.map((id) => [id, true])),
      }));
    }

    requestAnimationFrame(() => {
      const textarea = taRef.current;
      const header = document.querySelector("header");

      if (!textarea || !header) return;

      const textareaRect = textarea.getBoundingClientRect();
      const headerRect = header.getBoundingClientRect();

      const spacing = headerRect.height;
      const visibleTop = headerRect.bottom + spacing;

      if (textareaRect.top < visibleTop) {
        const absoluteTop = window.scrollY + textareaRect.top;
        const targetScrollY = absoluteTop - visibleTop;

        window.scrollTo({
          top: targetScrollY,
          behavior: "smooth",
        });
      }

      textarea.focus();
      autoResize();
    });
  };

  const onReact = (comment: VideoCommentT, reaction: "like" | "dislike") => {
    if (reactionMutation.isPending) return;
    reactionMutation.mutate({ commentId: comment.id, reaction });
  };

  const onEditStart = (comment: VideoCommentT) => {
    setReplyingTo(null);
    setEditingCommentId(comment.id);
    setEditingValue(comment.content);
  };

  const onEditCancel = () => {
    setEditingCommentId(null);
    setEditingValue("");
  };

  const onEditConfirm = (comment: VideoCommentT) => {
    const content = editingValue.trim();
    if (!content || content === comment.content.trim() || editMutation.isPending) return;

    editMutation.mutate({ commentId: comment.id, content });
  };

  const onDelete = async (comment: VideoCommentT) => {
    if (deleteMutation.isPending) return;

    const confirmed = await confirm({
      title: t("deleteCommentTitle"),
      message: t("deleteCommentMessage"),
      yesText: t("delete"),
      noText: t("cancel"),
    });

    if (!confirmed) return;
    deleteMutation.mutate(comment);
  };

  const submitComment = () => {
    const content = value.trim();
    if (!content || submitMutation.isPending) return;

    submitMutation.mutate({
      content,
      ...(replyingTo ? { parent_id: replyingTo.id } : {}),
    });
  };

  const totalCount = useMemo(
    () => countUniqueComments(sortedParents, repliesByParent),
    [repliesByParent, sortedParents]
  );

  const mobileThreadId = mobileThreadStack.length > 0 ? mobileThreadStack[mobileThreadStack.length - 1] : null;
  const mobileThreadComment = mobileThreadId ? hydratedCommentsMap.get(mobileThreadId) ?? null : null;
  const mobileThreadRootId = mobileThreadId
    ? findRootParentId(mobileThreadId, hydratedCommentsMap) ?? mobileThreadId
    : null;

  const mobileThreadReplies = useMemo(() => {
    if (!mobileThreadId) return [];

    if (repliesTreeByParent[mobileThreadId]) {
      return repliesTreeByParent[mobileThreadId];
    }

    for (const nodes of Object.values(repliesTreeByParent)) {
      const match = findCommentNode(nodes, mobileThreadId);
      if (match) {
        return match.children;
      }
    }

    return [];
  }, [mobileThreadId, repliesTreeByParent]);

  const mobileThreadLoading = mobileThreadRootId ? repliesLoadingByParent[mobileThreadRootId] : false;

  useEffect(() => {
    if (!mobileThreadId || mobileThreadPhase !== "enter") return;

    const timeout = window.setTimeout(() => setMobileThreadPhase("idle"), 220);
    return () => window.clearTimeout(timeout);
  }, [mobileThreadId, mobileThreadPhase]);

  const closeMobileThreadLevel = () => {
    setMobileThreadDirection("back");
    setMobileThreadPhase("exit");

    window.setTimeout(() => {
      setMobileThreadStack((prev) => prev.slice(0, -1));
      setMobileThreadPhase("enter");
    }, 220);
  };

  const openMobileReplyThread = (commentId: string) => {
    setMobileThreadDirection("forward");
    setMobileThreadPhase("enter");
    setMobileThreadStack((prev) => [...prev, commentId]);
  };

  const isCurrentUser = (comment: VideoCommentT) => isCommentOwnedByUser(comment, currentUserId, currentUserName);
  const canDelete = (comment: VideoCommentT) => canDeleteComment(comment, currentUserId, currentUserName, isAdmin);
  const isEditPending = (commentId: string) => editMutation.isPending && editingCommentId === commentId;
  const isDeletePending = (commentId: string) => deleteMutation.isPending && deleteMutation.variables?.id === commentId;

  const content = (
    <div className={`flex flex-col ${variant === "drawer" ? "" : "p-3.75 bg-(--background2)! rounded-2xl!"}`}>
      <div className="collection-header comments-header px-0! h-auto!">
        <h2 className="mb-2 text-lg font-semibold max-[500px]:text-md max-[500px]:ml-6">{t("commentCount", { count: totalCount })}</h2>
      </div>

      <CommentComposer
        userProfileImage={userProfileImage}
        replyingTo={replyingTo}
        value={value}
        textareaRef={taRef}
        onChange={setValue}
        onCancelReply={() => {setReplyingTo(null); scrollBackTo?.classList.remove("replying"); setScrollBackTo(null);}}
        onAutoResize={autoResize}
        onSubmit={submitComment}
        isSubmitting={submitMutation.isPending}
        isSubmitError={submitMutation.isError}
        scrollBackTo={scrollBackTo}
      />

      <div className={`comments-main comments-main-shell pt-4 ${mobileThreadId ? "mobile-thread-open" : ""}`}>
        <div className="comments-list-view">
          <CommentThread
            parents={sortedParents}
            repliesTreeByParent={repliesTreeByParent}
            repliesByParent={repliesByParent}
            repliesLoadingByParent={repliesLoadingByParent}
            expanded={expanded}
            onToggleReplies={toggleReplies}
            isLoading={isLoading || isFetching}
            hasData={!!data}
            editingCommentId={editingCommentId}
            editingValue={editingValue}
            isReactionPending={reactionMutation.isPending}
            isEditPending={isEditPending}
            isDeletePending={isDeletePending}
            isCurrentUser={isCurrentUser}
            canDelete={canDelete}
            onReply={onReply}
            onReact={onReact}
            onEditStart={onEditStart}
            onEditChange={setEditingValue}
            onEditCancel={onEditCancel}
            onEditConfirm={onEditConfirm}
            onDelete={onDelete}
          />
        </div>

        <MobileCommentThreadView
          mobileThreadId={mobileThreadId}
          mobileThreadComment={mobileThreadComment}
          mobileThreadReplies={mobileThreadReplies}
          mobileThreadLoading={mobileThreadLoading}
          mobileThreadPhase={mobileThreadPhase}
          mobileThreadDirection={mobileThreadDirection}
          onBack={closeMobileThreadLevel}
          onOpenMobileReply={openMobileReplyThread}
          editingCommentId={editingCommentId}
          editingValue={editingValue}
          isReactionPending={reactionMutation.isPending}
          isEditPending={isEditPending}
          isDeletePending={isDeletePending}
          isCurrentUser={isCurrentUser}
          canDelete={canDelete}
          onReply={onReply}
          onReact={onReact}
          onEditStart={onEditStart}
          onEditChange={setEditingValue}
          onEditCancel={onEditCancel}
          onEditConfirm={onEditConfirm}
          onDelete={onDelete}
        />
      </div>

      <ConfirmDialog {...dialogProps} />
    </div>
  );

  if (variant === "drawer") {
    const handleClose = () => {
      setMobileThreadStack([]);
      setIsDrawerOpen(false);
      window.setTimeout(() => onClose?.(), 320);
    };

    return (
      <div className={`sidePlaylists sideComments ${isDrawerOpen ? "" : "closed"}`}>
        <div className="playlistHeader">
          <span className="titleBar">
            <h2 className="flex items-center gap-2 mt-1">{CommentSVG}{t("comments")}</h2>
            <button onClick={handleClose} aria-label={t("close")}>
              {CloseSVG}
            </button>
          </span>
        </div>

        <div className="similar">{content}</div>
      </div>
    );
  }

  return content;
}

export default CommentsSection;
