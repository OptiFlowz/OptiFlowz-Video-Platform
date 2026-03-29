import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Props = {
  open: boolean;
  title?: string;
  message?: string;
  yesText?: string;
  noText?: string;
  onYes: () => void;
  onNo: () => void;
};

export function ConfirmDialog({
  open,
  title = "Confirm",
  message = "Are you sure?",
  yesText = "Yes",
  noText = "No",
  onYes,
  onNo,
}: Props) {
  const DURATION = 200;
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const t = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (t.current) window.clearTimeout(t.current);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setVisible(false);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
      return;
    }

    setVisible(false);

    t.current = window.setTimeout(() => setMounted(false), DURATION);
  }, [open]);

  if (!mounted) return null;

  return createPortal(
    (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-200 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
      role="dialog"
      aria-modal="true"
      onMouseDown={onNo}
    >
      <div
        className={`absolute inset-0 bg-black/50 transition-opacity duration-200 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
      />

      <div
        className={`relative w-[min(520px,90vw)] rounded-3xl bg-(--background1) border border-(--border1) p-6 shadow-lg
        transition-all duration-200 ease-out will-change-transform
        ${visible ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="mt-2">{message}</p>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onNo}
            className="button px-4 py-2 cursor-pointer rounded-full bg-(--background2) hover:bg-(--background3)"
          >
            {noText}
          </button>
          <button
            type="button"
            onClick={onYes}
            className="button px-4 py-2 cursor-pointer rounded-full bg-(--accentRed) text-white"
          >
            {yesText}
          </button>
        </div>
      </div>
    </div>
    ),
    document.body
  );
}
