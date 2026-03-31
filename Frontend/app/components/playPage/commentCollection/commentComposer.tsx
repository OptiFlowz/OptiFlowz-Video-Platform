import { useRef, type RefObject } from "react";
import { CommentSendSVG } from "~/constants";
import type { VideoCommentT } from "~/types";
import { useI18n } from "~/i18n";

type CommentComposerProps = {
  userProfileImage: string;
  replyingTo: VideoCommentT | null;
  value: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onChange: (value: string) => void;
  onCancelReply: () => void;
  onAutoResize: () => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  isSubmitError: boolean;
  scrollBackTo?: HTMLSpanElement | null;
};

function CommentComposer({
  userProfileImage,
  replyingTo,
  value,
  textareaRef,
  onChange,
  onCancelReply,
  onAutoResize,
  onSubmit,
  isSubmitting,
  isSubmitError,
  scrollBackTo
}: CommentComposerProps) {
  const { t } = useI18n();

  const timeoutRef = useRef<NodeJS.Timeout>(null);

  const handleReplyClick = () => {
      if(scrollBackTo){
        scrollBackTo.scrollIntoView({ behavior: "smooth", block: "center" });
        const commentParent = (scrollBackTo.parentElement?.parentElement?.parentElement as HTMLDivElement);

        const observer = new IntersectionObserver((entries) => {
          if (entries[0].isIntersecting && commentParent) {
            commentParent.classList.add("focusedComment");
            
            if(timeoutRef.current) {
              clearTimeout(timeoutRef.current);
            }
            timeoutRef.current = setTimeout(() => {
              commentParent.classList.remove("focusedComment");
            }, 1010);

            observer.unobserve(scrollBackTo);
            observer.disconnect();
          }
        }, { threshold: 0.5 });
        observer.observe(scrollBackTo);
      }
  }

  return (
    <div className="comment-input bg-(--background2) rounded-xl px-3 py-3 flex w-full gap-3 items-start">
      <img
        src={userProfileImage}
        alt="Profile"
        className="w-9 h-9 rounded-full object-cover border-2! border-white! border-solid! mt-0.5 shrink-0"
      />

      <div className="flex-1 min-w-0">
        {replyingTo && (
          <div className="flex items-center gap-1 mb-2 text-sm opacity-80">
            <span
              onClick={handleReplyClick}
              className="replyIndicator"
            >
              {t("replyingTo", { name: replyingTo.author_full_name })}
            </span>
            <button
              type="button"
              onClick={onCancelReply}
              className="reply bg-(--background2)! hover:bg-(--background3)! mt-0! ml-0!"
            >
              {t("cancel")}
            </button>
          </div>
        )}

        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0 min-h-9 pt-1">
            <textarea
              ref={textareaRef}
              placeholder={replyingTo ? t("replyToPlaceholder", { name: replyingTo.author_full_name }) : t("addCommentPlaceholder")}
              rows={1}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onInput={onAutoResize}
              onFocus={onAutoResize}
              className="block w-full outline-none text-lg font-medium resize-none bg-transparent leading-6 overflow-hidden min-h-6 max-h-40 py-1"
              style={{ height: "32px" }}
            />
          </div>

          {isSubmitError && <span className="text-sm text-red-400 mr-auto self-center">{t("failedToPostComment")}</span>}

          <button
            type="button"
            onClick={onSubmit}
            disabled={!value.trim() || isSubmitting}
            aria-label={replyingTo ? t("sendReply") : t("sendComment")}
            className="px-4 py-2 rounded-full bg-(--accentBlue) hover:bg-(--accentBlue2) transition-colors cursor-pointer text-white disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-(--accentBlue)! shrink-0 self-end max-[500px]:flex max-[500px]:items-center max-[500px]:justify-center max-[500px]:p-2"
          >
            {isSubmitting ? (
              t("posting")
            ) : (
              <>
                <span className="max-[500px]:hidden">{replyingTo ? t("reply") : t("comment")}</span>
                <span className="hidden max-[500px]:inline-flex items-center justify-center">{CommentSendSVG}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default CommentComposer;
