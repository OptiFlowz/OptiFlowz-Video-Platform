import { scrollWithinPlayerSheet } from "../playerCollection/sheetScroll";
import { useAuthorization } from "~/authorization/authorization";
import { P } from "~/authorization/permissions";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useInfiniteQuery, useMutation, useQueries, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { fetchFn } from "~/API";
import { CloseSVG, CommentSVG } from "~/constants";
import { getStoredUser, getToken, getUserImageUrl } from "~/functions";
import type {
  CommentReactionResponseT,
  FetchCommentRepliesT,
  FetchVideoCommentsT,
  PostCommentResponseT,
  VideoCommentT,
  VideoT,
} from "~/types";
import DefaultProfile from "../../../../assets/DefaultProfile.webp";
import { ConfirmDialog } from "../../confirmPopup/confirmDialog";
import { useConfirm } from "../../confirmPopup/useConfirm";
import { useI18n } from "~/i18n";
import { fetchComments, fetchReplies } from "./api";
import InfiniteScroll from "~/components/library/infiniteScroll";
import { changeReplyCount, COMMENT_PAGE_SIZE, isThreadOpen, nextCommentPage, uniqueComments, updateRootPage, updateReplyPage, type ReplyPage } from "./cache";
import CommentComposer from "./commentComposer";
import PlayerSheet from "../playerCollection/playerSheet";
import { CommentThread, MobileCommentThreadView } from "./commentThread";
import type { CommentsSectionProps } from "./types";
import { buildRepliesTree, getAncestorChain, isCommentOwnedByUser, normalizeSubmittedComment } from "./utils";

type RootComments = InfiniteData<FetchVideoCommentsT>;

function ReplyLoadMore({ id, hasMore, fetching, error, onLoadMore }: {
  id: string; hasMore: boolean; fetching: boolean; error: boolean; onLoadMore: (id: string) => void;
}) {
  const { t } = useI18n();
  const loadMore = useCallback(() => onLoadMore(id), [id, onLoadMore]);
  return <InfiniteScroll hasMore={hasMore} fetching={fetching} error={error} onLoadMore={loadMore} loadingLabel={t("loadingReplies")} />;
}

function VideoComments({ videoId, variant = "inline", onClose }: CommentsSectionProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const sectionRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const focusResetTimeoutRef = useRef<number | null>(null);
  const userProfileImage = getUserImageUrl() || DefaultProfile;
  const token = getToken() ?? "";
  const storedUser = getStoredUser();
  const { can, user } = useAuthorization();
  const currentUserName = storedUser?.user?.full_name ?? "";
  const currentUserId = user?.id ?? storedUser?.user?.id ?? "";

  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 500px)").matches);
  const [postedReplies, setPostedReplies] = useState<Record<string, VideoCommentT[]>>({});
  const [replyPages, setReplyPages] = useState<Record<string, ReplyPage>>({});
  const [value, setValue] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [replyingTo, setReplyingTo] = useState<VideoCommentT | null>(null);
  const [focusedCommentId, setFocusedCommentId] = useState<string | null>(null);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [mobileThreadStack, setMobileThreadStack] = useState<string[]>([]);
  const [mobileThreadPhase, setMobileThreadPhase] = useState<"idle" | "enter" | "exit">("idle");
  const [mobileThreadDirection, setMobileThreadDirection] = useState<"forward" | "back">("forward");
  const { confirm, dialogProps } = useConfirm();
  const mobileThreadId = isMobile ? mobileThreadStack.at(-1) ?? null : null;

  useEffect(() => {
    const media = window.matchMedia("(max-width: 500px)");
    const update = () => setIsMobile(media.matches);
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  const headers = useMemo(() => {
    const nextHeaders = new Headers();
    nextHeaders.set("Content-Type", "application/json");
    if (token) {
      nextHeaders.set("Authorization", `Bearer ${token}`);
    }
    return nextHeaders;
  }, [token]);

  const commentsKey = ["video-comments", videoId, "infinite"] as const;
  const repliesKey = ["comment-replies", videoId] as const;
  const rootQuery = useInfiniteQuery({
    queryKey: commentsKey,
    initialPageParam: 1,
    queryFn: ({ signal, pageParam }) => fetchComments(videoId, headers, pageParam, COMMENT_PAGE_SIZE, signal),
    getNextPageParam: nextCommentPage,
    enabled: !!videoId && !!token && !mobileThreadId,
    staleTime: 4 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const { data, isLoading, isFetching, isError, refetch, fetchNextPage, isFetchNextPageError, hasNextPage } = rootQuery;
  const loadMoreRoots = useCallback(() => {
    if (isError && !isFetchNextPageError) void refetch();
    else void fetchNextPage({ cancelRefetch: false });
  }, [isError, isFetchNextPageError, refetch, fetchNextPage]);
  // Subscribe to the already-loaded video. Counting never fetches entire threads.
  const subscribeToVideo = useCallback((notify: () => void) => queryClient.getQueryCache().subscribe(event => {
    if (event.query.queryKey[0] === "video" && event.query.queryKey[1] === videoId) notify();
  }), [queryClient, videoId]);
  const videoCommentCount = useSyncExternalStore(subscribeToVideo,
    () => queryClient.getQueryData<VideoT>(["video", videoId])?.comment_count, () => undefined);
  const parents = useMemo(() => uniqueComments(data?.pages.flatMap(page => page.comments) ?? []), [data]);
  const replyEntries = Object.entries(replyPages);
  const replyRequests = replyEntries.flatMap(([id, state]) => Array.from({ length: state.pages }, (_, index) => ({ id, page: index + 1, state })));
  const visibleCommentIds = new Set(parents.map(comment => comment.id));
  for (const { id, page } of replyRequests) {
    queryClient.getQueryData<FetchCommentRepliesT>([...repliesKey, id, page, COMMENT_PAGE_SIZE])?.replies.forEach(comment => visibleCommentIds.add(comment.id));
  }
  Object.values(postedReplies).flat().forEach(comment => visibleCommentIds.add(comment.id));
  const activeReplyIds = new Set(replyEntries.filter(([id, state]) => state.comment.reply_count > 0 &&
    (isMobile ? id === mobileThreadId : isThreadOpen(id, parents, expanded, [], replyPages, visibleCommentIds))).map(([id]) => id));
  const repliesQueries = useQueries({
    queries: replyRequests.map(({ id, page }) => ({
      queryKey: [...repliesKey, id, page, COMMENT_PAGE_SIZE],
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchReplies(id, headers, page, COMMENT_PAGE_SIZE, signal),
      enabled: !!token && activeReplyIds.has(id),
      staleTime: 4 * 60 * 1000,
      refetchOnWindowFocus: false,
    })),
  });
  const activeReplySignature = [...activeReplyIds].join(",");
  useEffect(() => {
    if (mobileThreadId) void queryClient.cancelQueries({ queryKey: ["video-comments", videoId, "infinite"] });
    const active = new Set(activeReplySignature.split(","));
    void queryClient.cancelQueries({ queryKey: ["comment-replies", videoId], predicate: query => !active.has(String(query.queryKey[2])) });
  }, [activeReplySignature, mobileThreadId, queryClient, videoId]);

  const autoResize = () => {
    const element = taRef.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${element.scrollHeight}px`;
  };

  const repliesByParent: Record<string, VideoCommentT[]> = {};
  const replyQueriesById: Record<string, typeof repliesQueries> = {};
  replyRequests.forEach(({ id }, index) => (replyQueriesById[id] ??= []).push(repliesQueries[index]));
  for (const [id, queries] of Object.entries(replyQueriesById)) {
    repliesByParent[id] = uniqueComments([...queries.flatMap(query => query.data?.replies ?? []), ...(postedReplies[id] ?? [])]);
  }
  const hydratedCommentsMap = new Map<string, VideoCommentT>();
  for (const comment of [...parents, ...Object.values(repliesByParent).flat()]) hydratedCommentsMap.set(comment.id, comment);
  const repliesTreeByParent = buildRepliesTree(parents, repliesByParent);
  const replyResultsRef = useRef(replyQueriesById);
  replyResultsRef.current = replyQueriesById;
  const loadMoreReplies = useCallback((id: string) => {
    const queries = replyResultsRef.current[id];
    const last = queries?.at(-1);
    if (!last || queries.some(query => query.isFetching)) return;
    const failed = queries.filter(query => query.isError);
    if (failed.length) { failed.forEach(query => void query.refetch()); return; }
    if (last.data?.pagination.hasNextPage) setReplyPages(previous => ({ ...previous, [id]: { ...previous[id], pages: previous[id].pages + 1 } }));
  }, []);

  const ensureReplyPage = (comment: VideoCommentT) => {
    setReplyPages(previous => ({ ...previous, [comment.id]: { comment, pages: previous[comment.id]?.pages ?? 1 } }));
  };
  const cancelCommentRequests = (parentId?: string | null) => Promise.all([
    queryClient.cancelQueries({ queryKey: commentsKey }),
    parentId ? queryClient.cancelQueries({ queryKey: [...repliesKey, parentId] }) : Promise.resolve(),
  ]);
  const cancelItemRequests = (id: string) => Promise.all([
    queryClient.cancelQueries({ queryKey: commentsKey, predicate: query => (query.state.data as RootComments | undefined)?.pages.some(page => page.comments.some(comment => comment.id === id)) ?? false }),
    queryClient.cancelQueries({ queryKey: repliesKey, predicate: query => (query.state.data as FetchCommentRepliesT | undefined)?.replies.some(comment => comment.id === id) ?? false }),
  ]);
  const updateCachedComments = (transform: (comment: VideoCommentT) => VideoCommentT, created?: VideoCommentT, deleted?: VideoCommentT) => {
    queryClient.setQueryData<RootComments>(commentsKey, current => current && ({ ...current, pages: current.pages.map(page => updateRootPage(page, transform, created, deleted)!) }));
    queryClient.setQueriesData<FetchCommentRepliesT>({ queryKey: repliesKey }, current => updateReplyPage(current, transform, created, deleted));
    setReplyPages(previous => Object.fromEntries(Object.entries(previous).map(([id, state]) => [id, { ...state, comment: transform(state.comment) }])));
    setPostedReplies(previous => Object.fromEntries(Object.entries(previous).map(([id, replies]) => [id, replies.map(transform).filter(reply => reply.id !== deleted?.id)])));
    if (created?.parent_id) setPostedReplies(previous => ({ ...previous, [created.parent_id!]: uniqueComments([...(previous[created.parent_id!] ?? []), created]) }));
  };
  const changeTotalCount = (delta: number) => {
    queryClient.setQueryData<VideoT>(["video", videoId], current => current && ({ ...current, comment_count: Math.max(0, (current.comment_count ?? data?.pages[0]?.total ?? 0) + delta) }));
  };
  const refreshPages = (parentId?: string | null) => {
    void queryClient.invalidateQueries({ queryKey: commentsKey });
    if (parentId) void queryClient.invalidateQueries({ queryKey: [...repliesKey, parentId] });
  };

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
    onSuccess: async ({ comment }, variables) => {
      await cancelCommentRequests(variables.parent_id);
      const normalized = normalizeSubmittedComment(comment, currentUserName, userProfileImage === DefaultProfile ? "" : userProfileImage);
      const parentId = variables.parent_id ?? null;
      updateCachedComments(item => changeReplyCount(item, parentId, 1), normalized);
      changeTotalCount(1);
      setValue("");
      setReplyingTo(null);
      autoResize();
      if (parentId) {
        const parent = hydratedCommentsMap.get(parentId);
        if (parent) ensureReplyPage(changeReplyCount(parent, parentId, 1));
        const chain = getAncestorChain(parentId, hydratedCommentsMap);
        if (isMobile) setMobileThreadStack(chain);
        else setExpanded(previous => ({ ...previous, ...Object.fromEntries(chain.map(id => [id, true])) }));
      }
      // Keep loaded rows and show the posted reply immediately. Offset pages only
      // need repairing after deletion; posting never downloads unseen history.
      if (!data) void rootQuery.refetch();
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
    onSuccess: async (response, variables) => {
      await cancelItemRequests(variables.commentId);
      const reaction = variables.reaction === "like" ? 1 : -1;
      updateCachedComments(comment => comment.id === variables.commentId
        ? { ...comment, like_count: response.like_count, dislike_count: response.dislike_count, my_reaction: comment.my_reaction === reaction ? null : reaction }
        : comment);
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
    onSuccess: async ({ comment }) => {
      await cancelItemRequests(comment.id);
      updateCachedComments(item => item.id === comment.id ? { ...item, ...comment } : item);
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
    onSuccess: async (_, comment) => {
      await cancelCommentRequests(comment.parent_id);
      updateCachedComments(item => changeReplyCount(item, comment.parent_id, -1), undefined, comment);
      // The existing API soft-deletes the target and excludes its direct children
      // from the video's aggregate. No speculative recursive total is needed.
      changeTotalCount(-1 - (replyQueriesById[comment.id]?.at(-1)?.data?.pagination.total ?? comment.reply_count ?? 0));
      const removed = new Set([comment.id]);
      for (const [id] of replyEntries) {
        if (getAncestorChain(id, hydratedCommentsMap).includes(comment.id)) removed.add(id);
      }
      setReplyPages(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => !removed.has(id))));
      setPostedReplies(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => !removed.has(id))));
      setExpanded(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => !removed.has(id))));
      setMobileThreadStack(previous => previous.filter(id => !removed.has(id)));
      for (const id of removed) queryClient.removeQueries({ queryKey: [...repliesKey, id] });
      if (editingCommentId === comment.id) { setEditingCommentId(null); setEditingValue(""); }
      if (replyingTo?.id === comment.id) setReplyingTo(null);
      refreshPages(comment.parent_id);
    },
  });

  const toggleReplies = (parentId: string) => {
    const parent = hydratedCommentsMap.get(parentId);
    if (parent) ensureReplyPage(parent);
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 500px)").matches) {
      setMobileThreadDirection("forward");
      setMobileThreadPhase("enter");
      setMobileThreadStack((prev) => [...prev, parentId]);
      return;
    }

    if (expanded[parentId]) void queryClient.cancelQueries({ queryKey: [...repliesKey, parentId] });
    setExpanded((prev) => ({ ...prev, [parentId]: !prev[parentId] }));
  };

  const highlightComment = (commentId: string) => {
    setFocusedCommentId(commentId);

    if (focusResetTimeoutRef.current) {
      window.clearTimeout(focusResetTimeoutRef.current);
    }

    focusResetTimeoutRef.current = window.setTimeout(() => {
      setFocusedCommentId((current) => (current === commentId ? null : current));
    }, 1800);
  };

  const scrollToComment = (commentId: string) => {
    const target = sectionRef.current?.querySelector(`[data-comment-id="${CSS.escape(commentId)}"]`) as HTMLElement | null;
    if (!target) return false;

    if (scrollWithinPlayerSheet(target, "start")) { highlightComment(commentId); return true; }
    const header = document.querySelector("header");
    const headerHeight = header instanceof HTMLElement ? header.getBoundingClientRect().height : 0;
    const absoluteTop = window.scrollY + target.getBoundingClientRect().top;

    window.scrollTo({
      top: Math.max(absoluteTop - headerHeight - 24, 0),
      behavior: "smooth",
    });

    highlightComment(commentId);
    return true;
  };

  const navigateToComment = (commentId: string) => {
    const chain = getAncestorChain(commentId, hydratedCommentsMap);
    if (chain.length > 1) {
      setExpanded((prev) => ({
        ...prev,
        ...Object.fromEntries(chain.slice(0, -1).map((id) => [id, true])),
      }));
    }

    let attempts = 0;
    const tryScroll = () => {
      if (scrollToComment(commentId)) return;
      if (attempts >= 8) return;
      attempts += 1;
      window.setTimeout(tryScroll, 90);
    };

    requestAnimationFrame(() => {
      requestAnimationFrame(tryScroll);
    });
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
            button.classList.remove("replying");
        });

      scrollBackTo.classList.add("replying");
    }


    requestAnimationFrame(() => {
      const textarea = taRef.current;
      const header = document.querySelector("header");

      if (!textarea) return;
      if (scrollWithinPlayerSheet(textarea)) {
        textarea.focus({ preventScroll: true });
        autoResize();
        return;
      }
      if (!header) return;

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

  useEffect(() => {
    return () => {
      if (focusResetTimeoutRef.current) {
        window.clearTimeout(focusResetTimeoutRef.current);
      }
    };
  }, []);

  const onReact = (comment: VideoCommentT, reaction: "like" | "dislike") => {
    if (!can(P.commentsReact) || reactionMutation.isPending) return;
    reactionMutation.mutate({ commentId: comment.id, reaction });
  };

  const onEditStart = (comment: VideoCommentT) => {
    if (!can(P.commentsEditOwn) || !isCurrentUser(comment)) return;
    setReplyingTo(null);
    setEditingCommentId(comment.id);
    setEditingValue(comment.content);
  };

  const onEditCancel = () => {
    setEditingCommentId(null);
    setEditingValue("");
  };

  const onEditConfirm = (comment: VideoCommentT) => {
    if (!can(P.commentsEditOwn) || !isCurrentUser(comment)) return;
    const content = editingValue.trim();
    if (!content || content === comment.content.trim() || editMutation.isPending) return;

    editMutation.mutate({ commentId: comment.id, content });
  };

  const onDelete = async (comment: VideoCommentT) => {
    if (!canDelete(comment) || deleteMutation.isPending) return;

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
    if (!can(P.commentsCreate)) return;
    const content = value.trim();
    if (!content || submitMutation.isPending) return;

    submitMutation.mutate({
      content,
      ...(replyingTo ? { parent_id: replyingTo.id } : {}),
    });
  };

  const totalCount = videoCommentCount ?? data?.pages[0]?.total ?? 0;
  const mobileThreadComment = mobileThreadId ? hydratedCommentsMap.get(mobileThreadId) ?? null : null;
  const mobileThreadReplies = mobileThreadComment ? buildRepliesTree([mobileThreadComment], repliesByParent)[mobileThreadComment.id] : [];
  const mobileThreadLoading = !!mobileThreadId && !!replyQueriesById[mobileThreadId]?.[0]?.isLoading;

  const renderRepliesFooter = (parentId: string) => {
    if (!activeReplyIds.has(parentId)) return null;
    const queries = replyQueriesById[parentId];
    const last = queries?.at(-1);
    if (!last) return null;
    const hasMore = last.isLoading || (!!last.data?.pagination.hasNextPage && (repliesByParent[parentId]?.length ?? 0) < last.data.pagination.total);
    return <div data-replies-more={parentId}>
      <ReplyLoadMore key={queries.filter(query => query.data).length} id={parentId} hasMore={hasMore} fetching={queries.some(query => query.isFetching)} error={queries.some(query => query.isError)} onLoadMore={loadMoreReplies} />
    </div>;
  };

  useEffect(() => {
    if (!mobileThreadId || mobileThreadPhase !== "enter") return;

    const timeout = window.setTimeout(() => setMobileThreadPhase("idle"), 220);
    return () => window.clearTimeout(timeout);
  }, [mobileThreadId, mobileThreadPhase]);

  const closeMobileThreadLevel = () => {
    if (mobileThreadId) void queryClient.cancelQueries({ queryKey: [...repliesKey, mobileThreadId] });
    setMobileThreadDirection("back");
    setMobileThreadPhase("exit");

    window.setTimeout(() => {
      setMobileThreadStack((prev) => prev.slice(0, -1));
      setMobileThreadPhase("enter");
    }, 220);
  };

  const openMobileReplyThread = (commentId: string) => {
    const comment = hydratedCommentsMap.get(commentId);
    if (comment) ensureReplyPage(comment);
    setMobileThreadDirection("forward");
    setMobileThreadPhase("enter");
    setMobileThreadStack((prev) => [...prev, commentId]);
  };

  const isCurrentUser = (comment: VideoCommentT) => isCommentOwnedByUser(comment, currentUserId, currentUserName);
  const canDelete = (comment: VideoCommentT) => can(P.commentsModerate) || (can(P.commentsDeleteOwn) && isCurrentUser(comment));
  const isEditPending = (commentId: string) => editMutation.isPending && editingCommentId === commentId;
  const isDeletePending = (commentId: string) => deleteMutation.isPending && deleteMutation.variables?.id === commentId;

  const content = (
    <div ref={sectionRef} className={`flex flex-col ${variant === "drawer" ? "" : "p-3.75 bg-(--background2)! rounded-2xl!"}`}>
      <div className="collection-header comments-header px-0! h-auto!">
        <h2 className="mb-2 text-lg font-semibold max-[500px]:text-md max-[500px]:ml-6">{t("commentCount", { count: totalCount })}</h2>
      </div>

      {can(P.commentsCreate) && <CommentComposer
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
      />}

      <div className={`comments-main comments-main-shell pt-4 ${mobileThreadId ? "mobile-thread-open" : ""}`}>
        <div className="comments-list-view">
          {!mobileThreadId && <CommentThread
            parents={parents}
            repliesTreeByParent={repliesTreeByParent}
            repliesByParent={repliesByParent}
            renderRepliesFooter={renderRepliesFooter}
            expanded={expanded}
            onToggleReplies={toggleReplies}
            isLoading={isLoading || isFetching}
            hasData={!!data || isError}
            editingCommentId={editingCommentId}
            editingValue={editingValue}
            isReactionPending={reactionMutation.isPending}
            isEditPending={isEditPending}
            isDeletePending={isDeletePending}
            isCurrentUser={isCurrentUser}
            canDelete={canDelete}
            onReply={onReply}
            onNavigateToComment={navigateToComment}
            onReact={onReact}
            onEditStart={onEditStart}
            onEditChange={setEditingValue}
            onEditCancel={onEditCancel}
            onEditConfirm={onEditConfirm}
            onDelete={onDelete}
            focusedCommentId={focusedCommentId}
          />}
          {!mobileThreadId && (parents.length > 0 || isError) && <div data-comments-more>
            <InfiniteScroll key={data?.pages.length ?? 0} hasMore={hasNextPage} fetching={isFetching} error={isError} onLoadMore={loadMoreRoots} loadingLabel={t("loadingComments")} />
          </div>}
        </div>

        {mobileThreadId && <MobileCommentThreadView
          mobileThreadId={mobileThreadId}
          mobileThreadComment={mobileThreadComment}
          mobileThreadReplies={mobileThreadReplies}
          mobileThreadLoading={mobileThreadLoading}
          renderRepliesFooter={renderRepliesFooter}
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
          onNavigateToComment={navigateToComment}
          onReact={onReact}
          onEditStart={onEditStart}
          onEditChange={setEditingValue}
          onEditCancel={onEditCancel}
          onEditConfirm={onEditConfirm}
          onDelete={onDelete}
          focusedCommentId={focusedCommentId}
        />}
      </div>

      <ConfirmDialog {...dialogProps} />
    </div>
  );

  if (variant === "drawer") {
    return (
      <PlayerSheet label={t("comments")} className="sideComments" onClose={() => { setMobileThreadStack([]); onClose?.(); }} header={handleClose => (<>
          <span className="titleBar">
            <h2 className="flex items-center gap-2 mt-1">{CommentSVG}{t("comments")}</h2>
            <button onClick={handleClose} aria-label={t("close")}>
              {CloseSVG}
            </button>
          </span>
        </>)}>

        <div className="similar">{content}</div>
      </PlayerSheet>
    );
  }

  return content;
}

export default function CommentsSection(props: CommentsSectionProps) {
  return <VideoComments key={props.videoId} {...props} />;
}
