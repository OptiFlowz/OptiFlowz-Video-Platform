import { IconChevron } from "~/constants";
import { useI18n } from "~/i18n";
import type { VideoCommentT } from "~/types";
import type { CommentTreeNode } from "./types";
import CommentRow from "./commentRow";

type SharedThreadProps = {
  editingCommentId: string | null;
  editingValue: string;
  isReactionPending: boolean;
  isEditPending: (commentId: string) => boolean;
  isDeletePending: (commentId: string) => boolean;
  isCurrentUser: (comment: VideoCommentT) => boolean;
  canDelete: (comment: VideoCommentT) => boolean;
  onReply: (comment: VideoCommentT) => void;
  onReact: (comment: VideoCommentT, reaction: "like" | "dislike") => void;
  onEditStart: (comment: VideoCommentT) => void;
  onEditChange: (value: string) => void;
  onEditCancel: () => void;
  onEditConfirm: (comment: VideoCommentT) => void;
  onDelete: (comment: VideoCommentT) => void;
};

type NestedReplyTreeProps = Pick<
  CommentThreadProps,
  | "expanded"
  | "onToggleReplies"
  | "editingCommentId"
  | "editingValue"
  | "isReactionPending"
  | "isEditPending"
  | "isDeletePending"
  | "isCurrentUser"
  | "canDelete"
  | "onReply"
  | "onReact"
  | "onEditStart"
  | "onEditChange"
  | "onEditCancel"
  | "onEditConfirm"
  | "onDelete"
> & {
  nodes: CommentTreeNode[];
};

type CommentThreadProps = SharedThreadProps & {
  parents: VideoCommentT[];
  repliesTreeByParent: Record<string, CommentTreeNode[]>;
  repliesByParent: Record<string, VideoCommentT[]>;
  repliesLoadingByParent: Record<string, boolean>;
  expanded: Record<string, boolean>;
  onToggleReplies: (commentId: string) => void;
  isLoading: boolean;
  hasData: boolean;
};

function NestedReplyTree({
  nodes,
  expanded,
  onToggleReplies,
  editingCommentId,
  editingValue,
  isReactionPending,
  isEditPending,
  isDeletePending,
  isCurrentUser,
  canDelete,
  onReply,
  onReact,
  onEditStart,
  onEditChange,
  onEditCancel,
  onEditConfirm,
  onDelete,
}: NestedReplyTreeProps) {
  const { t } = useI18n();

  return (
    <>
      {nodes.map((reply) => {
        const hasChildren = reply.children.length > 0;
        const isOpen = !!expanded[reply.id];

        return (
          <div key={reply.id} className="relative">
            <span className="comment-node-elbow" />
            {hasChildren && <span className="thread-line nested"></span>}

            <CommentRow
              comment={reply}
              isCurrentUser={isCurrentUser(reply)}
              onReply={onReply}
              onReact={onReact}
              isReactionPending={isReactionPending}
              isEditing={editingCommentId === reply.id}
              editValue={editingValue}
              onEditStart={onEditStart}
              onEditChange={onEditChange}
              onEditCancel={onEditCancel}
              onEditConfirm={onEditConfirm}
              onDelete={onDelete}
              isEditPending={isEditPending(reply.id)}
              isDeletePending={isDeletePending(reply.id)}
              canDelete={canDelete(reply)}
            />

            {hasChildren && (
              <button
                type="button"
                onClick={() => onToggleReplies(reply.id)}
                className="reply mt-2 ml-13 flex items-center gap-2"
              >
                <IconChevron className={`w-4.5 h-4.5 transition duration-300 ease-out ${isOpen ? "rotate-180" : ""}`} />
                <span className="font-medium">
                  {isOpen ? t("hideReplies") : t("replyCountLabel", { count: reply.children.length })}
                </span>
              </button>
            )}

            {hasChildren && (
              <div className={`comment-replies-shell ${isOpen ? "open" : ""}`} aria-hidden={!isOpen}>
                <div className="comment-replies-inner">
                  <div className="comment-replies-panel mt-3 ml-7 pl-6">
                    <div className="flex flex-col gap-5">
                      <NestedReplyTree
                        nodes={reply.children}
                        expanded={expanded}
                        onToggleReplies={onToggleReplies}
                        editingCommentId={editingCommentId}
                        editingValue={editingValue}
                        isReactionPending={isReactionPending}
                        isEditPending={isEditPending}
                        isDeletePending={isDeletePending}
                        isCurrentUser={isCurrentUser}
                        canDelete={canDelete}
                        onReply={onReply}
                        onReact={onReact}
                        onEditStart={onEditStart}
                        onEditChange={onEditChange}
                        onEditCancel={onEditCancel}
                        onEditConfirm={onEditConfirm}
                        onDelete={onDelete}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

export function CommentThread({
  parents,
  repliesTreeByParent,
  repliesByParent,
  repliesLoadingByParent,
  expanded,
  onToggleReplies,
  isLoading,
  hasData,
  editingCommentId,
  editingValue,
  isReactionPending,
  isEditPending,
  isDeletePending,
  isCurrentUser,
  canDelete,
  onReply,
  onReact,
  onEditStart,
  onEditChange,
  onEditCancel,
  onEditConfirm,
  onDelete,
}: CommentThreadProps) {
  const { t } = useI18n();

  if (!hasData && isLoading) {
    return <h3 className="text-(--accentBlue) w-full text-center pb-1 font-medium">{t("loadingComments")}</h3>;
  }

  if (parents.length === 0) {
    return <h3 className="text-(--accentBlue) w-full text-center pb-1 font-medium">{t("noCommentsYet")}</h3>;
  }

  return (
    <div className="flex flex-col gap-5">
      {parents.map((comment) => {
        const replies = repliesTreeByParent[comment.id] ?? [];
        const isOpen = !!expanded[comment.id];
        const totalReplies = Math.max(comment.reply_count ?? 0, repliesByParent[comment.id]?.length ?? 0);

        return (
          <div key={comment.id} className="flex flex-col relative">
            <CommentRow
              comment={comment}
              isCurrentUser={isCurrentUser(comment)}
              onReply={onReply}
              onReact={onReact}
              isReactionPending={isReactionPending}
              isEditing={editingCommentId === comment.id}
              editValue={editingValue}
              onEditStart={onEditStart}
              onEditChange={onEditChange}
              onEditCancel={onEditCancel}
              onEditConfirm={onEditConfirm}
              onDelete={onDelete}
              isEditPending={isEditPending(comment.id)}
              isDeletePending={isDeletePending(comment.id)}
              canDelete={canDelete(comment)}
            />

            {totalReplies > 0 && <span className="thread-line"></span>}

            {totalReplies > 0 && (
              <button
                type="button"
                onClick={() => onToggleReplies(comment.id)}
                className="reply mt-2 ml-13 flex items-center gap-2"
              >
                <IconChevron className={`w-4.5 h-4.5 transition duration-300 ease-out ${isOpen ? "rotate-180" : ""}`} />
                <span className="font-medium">
                  {isOpen ? t("hideReplies") : t("replyCountLabel", { count: totalReplies })}
                </span>
              </button>
            )}

            {totalReplies > 0 && (
              <div className={`comment-replies-shell ${isOpen ? "open" : ""}`} aria-hidden={!isOpen}>
                <div className="comment-replies-inner">
                  <div className="comment-replies-panel mt-3 ml-7 pl-6 border-l border-white/20">
                    {repliesLoadingByParent[comment.id] ? (
                      <p className="text-sm opacity-70">{t("loadingReplies")}</p>
                    ) : replies.length > 0 ? (
                      <div className="flex flex-col gap-5">
                        <NestedReplyTree
                          nodes={replies}
                          expanded={expanded}
                          onToggleReplies={onToggleReplies}
                          editingCommentId={editingCommentId}
                          editingValue={editingValue}
                          isReactionPending={isReactionPending}
                          isEditPending={isEditPending}
                          isDeletePending={isDeletePending}
                          isCurrentUser={isCurrentUser}
                          canDelete={canDelete}
                          onReply={onReply}
                          onReact={onReact}
                          onEditStart={onEditStart}
                          onEditChange={onEditChange}
                          onEditCancel={onEditCancel}
                          onEditConfirm={onEditConfirm}
                          onDelete={onDelete}
                        />
                      </div>
                    ) : (
                      <p className="text-sm opacity-70">{t("repliesLoadFailed")}</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

type MobileCommentThreadViewProps = SharedThreadProps & {
  mobileThreadId: string | null;
  mobileThreadComment: VideoCommentT | null;
  mobileThreadReplies: CommentTreeNode[];
  mobileThreadLoading: boolean;
  mobileThreadPhase: "idle" | "enter" | "exit";
  mobileThreadDirection: "forward" | "back";
  onBack: () => void;
  onOpenMobileReply: (commentId: string) => void;
};

export function MobileCommentThreadView({
  mobileThreadId,
  mobileThreadComment,
  mobileThreadReplies,
  mobileThreadLoading,
  mobileThreadPhase,
  mobileThreadDirection,
  onBack,
  onOpenMobileReply,
  editingCommentId,
  editingValue,
  isReactionPending,
  isEditPending,
  isDeletePending,
  isCurrentUser,
  canDelete,
  onReply,
  onReact,
  onEditStart,
  onEditChange,
  onEditCancel,
  onEditConfirm,
  onDelete,
}: MobileCommentThreadViewProps) {
  const { t } = useI18n();

  return (
    <div
      key={mobileThreadId ?? "root-thread"}
      className={`mobile-thread-view ${mobileThreadId ? "open" : ""} ${mobileThreadPhase} ${mobileThreadDirection}`}
    >
      <div className="mobile-thread-view-header">
        <button type="button" onClick={onBack} className="reply mt-0! ml-0! flex items-center gap-2">
          <IconChevron className="w-4.5 h-4.5 rotate-90" />
          <span>{t("back")}</span>
        </button>
        <span className="text-sm font-semibold opacity-80">{t("thread")}</span>
      </div>

      {mobileThreadComment && (
        <div className="mobile-thread-parent relative">
          <CommentRow
            comment={mobileThreadComment}
            isCurrentUser={isCurrentUser(mobileThreadComment)}
            onReply={onReply}
            onReact={onReact}
            isReactionPending={isReactionPending}
            isEditing={editingCommentId === mobileThreadComment.id}
            editValue={editingValue}
            onEditStart={onEditStart}
            onEditChange={onEditChange}
            onEditCancel={onEditCancel}
            onEditConfirm={onEditConfirm}
            onDelete={onDelete}
            isEditPending={isEditPending(mobileThreadComment.id)}
            isDeletePending={isDeletePending(mobileThreadComment.id)}
            canDelete={canDelete(mobileThreadComment)}
          />
          {mobileThreadReplies.length > 0 && <span className="thread-line mobile-thread-parent-line"></span>}
        </div>
      )}

      <div className="mobile-thread-replies">
        {mobileThreadLoading ? (
          <p className="text-sm opacity-70">{t("loadingReplies")}</p>
        ) : mobileThreadReplies.length > 0 ? (
          <div className="flex flex-col gap-5">
            {mobileThreadReplies.map((reply) => {
              const hasChildren = reply.children.length > 0;

              return (
                <div key={reply.id} className="relative mobile-thread-reply-row">
                  <span className="comment-node-elbow mobile-thread-elbow" />
                  <CommentRow
                    comment={reply}
                    isCurrentUser={isCurrentUser(reply)}
                    onReply={onReply}
                    onReact={onReact}
                    isReactionPending={isReactionPending}
                    isEditing={editingCommentId === reply.id}
                    editValue={editingValue}
                    onEditStart={onEditStart}
                    onEditChange={onEditChange}
                    onEditCancel={onEditCancel}
                    onEditConfirm={onEditConfirm}
                    onDelete={onDelete}
                    isEditPending={isEditPending(reply.id)}
                    isDeletePending={isDeletePending(reply.id)}
                    canDelete={canDelete(reply)}
                  />

                  {hasChildren && (
                    <button
                      type="button"
                      onClick={() => onOpenMobileReply(reply.id)}
                      className="reply mt-2 ml-13 flex items-center gap-2"
                    >
                      <IconChevron className="w-4.5 h-4.5" />
                      <span className="font-medium">
                        {t("replyCountLabel", { count: reply.children.length })}
                      </span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm opacity-70">{t("noRepliesYet")}</p>
        )}
      </div>
    </div>
  );
}
