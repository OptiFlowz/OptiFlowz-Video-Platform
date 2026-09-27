import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "~/i18n";

type Props = {
  portalContainer?: Element;
  open: boolean;
  title?: string;
  message?: string;
  yesText?: string;
  noText?: string;
  onYes: () => void;
  onNo: () => void;
};

export function ConfirmDialog({
  portalContainer,
  open,
  title,
  message,
  yesText,
  noText,
  onYes,
  onNo,
}: Props) {
  const { t } = useI18n();
  const DURATION = 200;
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let firstFrame = 0;
    let secondFrame = 0;
    const cleanup = () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    };
    if (open) {
      setMounted(true);
      setVisible(false);

      firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => setVisible(true));
      });
      return cleanup;
    }

    setVisible(false);

    closeTimerRef.current = window.setTimeout(() => setMounted(false), DURATION);
    return cleanup;
  }, [open]);

  if (!mounted) return null;

  return createPortal(
    (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center popupMotionLayer ${
        visible ? "opacity-100" : "opacity-0"
      }`}
      role="dialog"
      aria-modal="true"
      onMouseDown={onNo}
    >
      <div
        className="absolute inset-0 bg-(--seethroughtBlack)"
      />

      <div
        className={`relative w-[min(520px,90vw)] rounded-3xl bg-(--background1) border border-(--border1) p-6 shadow-lg shadow-(color:--seethroughtBlack)
        popupMotionPanel
        ${visible ? "isOpen" : ""}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold">{title ?? t("adminConfirmTitle")}</h3>
        <p className="mt-2">{message ?? t("adminConfirmMessage")}</p>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onNo}
            className="button px-4 py-2 cursor-pointer rounded-full bg-(--background2) hover:bg-(--background3)"
          >
            {noText ?? t("adminNo")}
          </button>
          <button
            type="button"
            onClick={onYes}
            className="button px-4 py-2 cursor-pointer rounded-full bg-(--accentRed) text-(--text1)"
          >
            {yesText ?? t("adminYes")}
          </button>
        </div>
      </div>
    </div>
    ),
    portalContainer ?? document.body
  );
}
