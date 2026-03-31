import { useEffect, useRef, useState } from "react";
import { DeleteSVG, EditSVG, ReplySVG, ThumbIcon } from "~/constants";
import type { VideoCommentT } from "~/types";
import DefaultProfile from "../../../../assets/DefaultProfile.webp";
import { useI18n } from "~/i18n";
import { timeAgo } from "./utils";

type CommentRowProps = {
  comment: VideoCommentT;
  isCurrentUser: boolean;
  onReply: (comment: VideoCommentT, scrollBackTo: HTMLButtonElement) => void;
  onReact: (comment: VideoCommentT, reaction: "like" | "dislike") => void;
  isReactionPending: boolean;
  isEditing: boolean;
  editValue: string;
  onEditStart: (comment: VideoCommentT) => void;
  onEditChange: (value: string) => void;
  onEditCancel: () => void;
  onEditConfirm: (comment: VideoCommentT) => void;
  onDelete: (comment: VideoCommentT) => void;
  isEditPending: boolean;
  isDeletePending: boolean;
  canDelete: boolean;
};

function CommentRow({
  comment,
  isCurrentUser,
  onReply,
  onReact,
  isReactionPending,
  isEditing,
  editValue,
  onEditStart,
  onEditChange,
  onEditCancel,
  onEditConfirm,
  onDelete,
  isEditPending,
  isDeletePending,
  canDelete,
}: CommentRowProps) {
  const { t } = useI18n();
  const userReaction = comment.my_reaction;
  const isLiked = userReaction === 1;
  const isDisliked = userReaction === -1;
  const trimmedEditValue = editValue.trim();
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [likeAnimation, setLikeAnimation] = useState(false);
  const [dislikeAnimation, setDislikeAnimation] = useState(false);

  useEffect(() => {
    if (!isEditing) return;

    const textarea = editTextareaRef.current;
    if (!textarea) return;

    textarea.focus();
    const contentLength = textarea.value.length;
    textarea.setSelectionRange(contentLength, contentLength);
  }, [isEditing]);

  const handleReact = (reaction: "like" | "dislike") => {
    if (reaction === "like") {
      setLikeAnimation(true);
      window.setTimeout(() => setLikeAnimation(false), 300);
    } else {
      setDislikeAnimation(true);
      window.setTimeout(() => setDislikeAnimation(false), 300);
    }

    onReact(comment, reaction);
  };

  return (
    <div className="flex gap-3 relative min-w-0 w-fit commentContent">
      <img
        src={comment.author_image_url || DefaultProfile}
        alt={comment.author_full_name}
        className="w-10 h-10 rounded-full object-cover border-2! border-(--threadC1)! border-solid! shrink-0"
      />

      <div className="flex-1">
        <div className="flex items-center gap-2 gap-y-0 flex-wrap">
          <span className="font-semibold text-md">{comment.author_full_name}</span>
          <span className="text-sm opacity-70">{timeAgo(comment.created_at)}</span>
          {isCurrentUser && <span className="text-xs opacity-70 -ml-0.5">({t("yourComment")})</span>}
        </div>

        {isEditing ? (
          <div className="mb-2">
            <textarea
              ref={editTextareaRef}
              value={editValue}
              onChange={(e) => onEditChange(e.target.value)}
              rows={3}
              className="block w-full rounded-xl bg-(--background2)! px-3 py-2 text-[15px] leading-6 outline-none resize-y min-h-16 max-h-40 border border-white/15"
            />

            <div className="mt-2 flex items-center gap-1.5">
              <button
                type="button"
                onClick={onEditCancel}
                className="reply bg-(--background2)! hover:bg-(--background3)! mt-0! ml-0!"
                disabled={isEditPending}
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={() => onEditConfirm(comment)}
                className="reply rounded-full bg-(--accentBlue)! hover:bg-(--accentBlue2)! transition-colors cursor-pointer text-white disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-(--accentBlue)!"
                disabled={!trimmedEditValue || trimmedEditValue === comment.content.trim() || isEditPending}
              >
                {isEditPending ? t("saving") : t("confirm")}
              </button>
            </div>
          </div>
        ) : (
          <p className="mb-1.5 text-[15px] leading-6 opacity-95 whitespace-pre-wrap">{comment.content}</p>
        )}

        <div className="comment-actions mt-1 flex items-center gap-4 text-sm">
          <button
            type="button"
            onClick={() => handleReact("like")}
            className={`flex items-center transition ${isLiked ? "bookmarked" : ""}`}
            disabled={isReactionPending}
          >
            <span className={`comment-reaction-icon ${likeAnimation ? "like-animate" : ""}`}>
              <ThumbIcon filled={isLiked} />
            </span>
            <span>{comment.like_count ?? 0}</span>
          </button>

          <button
            type="button"
            onClick={() => handleReact("dislike")}
            className={`flex items-center transition ${isDisliked ? "bookmarked" : ""}`}
            disabled={isReactionPending}
          >
            <span className={`comment-reaction-icon rotated ${dislikeAnimation ? "dislike-animate" : ""}`}>
              <ThumbIcon filled={isDisliked} />
            </span>
          </button>

          <button
            type="button"
            onClick={e => onReply(comment, e.currentTarget as HTMLButtonElement)}
            className="flex items-center transition"
            disabled={isEditing}
          >
            {ReplySVG}
            <span>{t("reply")}</span>
          </button>

          {isCurrentUser && !isEditing && (
            <button
              type="button"
              onClick={() => onEditStart(comment)}
              className="flex items-center transition"
              disabled={isDeletePending}
            >
              <span>{EditSVG}</span>
            </button>
          )}

          {canDelete && !isEditing && (
            <button
              type="button"
              onClick={() => onDelete(comment)}
              className="flex items-center transition text-(--accentRed)"
              disabled={isDeletePending}
            >
              <span>{isDeletePending ? t("deleting") : DeleteSVG}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default CommentRow;
