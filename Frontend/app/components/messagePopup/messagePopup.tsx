import { useEffect, useLayoutEffect, useRef } from "react";
import { Link } from "react-router";
import PopupPortal from "~/components/popupPortal/popupPortal";

type Props = {
  open: boolean;
  message: string;
  onClose: () => void;
  onAfterClose?: () => void;
  actionHref?: string;
  actionLabel?: string;
  autoCloseMs?: number;
};

function MessagePopup({
  open,
  message,
  onClose,
  onAfterClose,
  actionHref,
  actionLabel,
  autoCloseMs,
}: Props) {
  const popupRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const afterCloseRef = useRef(onAfterClose);
  afterCloseRef.current = onAfterClose;

  useLayoutEffect(() => {
    if (open) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;

    let cancelled = false;
    const popup = popupRef.current;
    // Flush the closing styles before collecting the backdrop and panel transitions.
    if (popup) window.getComputedStyle(popup).opacity;
    const animations = popup?.getAnimations?.({ subtree: true }) ?? [];
    void Promise.allSettled(animations.map(animation => animation.finished)).then(() => {
      if (!cancelled) afterCloseRef.current?.();
    });
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!open || !autoCloseMs) return;

    const timeout = window.setTimeout(() => {
      onClose();
    }, autoCloseMs);

    return () => window.clearTimeout(timeout);
  }, [autoCloseMs, onClose, open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  return <PopupPortal>
    <div
      ref={popupRef}
      className={`popup ${open ? "active" : ""} ${actionHref ? "done" : ""}`}
      onClick={onClose}
      aria-hidden={!open}
    >
      <div
        className="popup-content flex items-center justify-center"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-lg text-center m-0!">
          {message}
          {actionHref && actionLabel && (
            <Link to={actionHref}>
              {actionLabel}
            </Link>
          )}
        </h2>
      </div>
    </div>
  </PopupPortal>;
}

export default MessagePopup;
