import { useEffect } from "react";
import { Link } from "react-router";

type Props = {
  open: boolean;
  message: string;
  onClose: () => void;
  actionHref?: string;
  actionLabel?: string;
  autoCloseMs?: number;
};

function MessagePopup({
  open,
  message,
  onClose,
  actionHref,
  actionLabel,
  autoCloseMs,
}: Props) {
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

  return (
    <div
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
  );
}

export default MessagePopup;
