import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "~/i18n";

type Props = {
  portalContainer?: Element;
  open: boolean;
  intent?: "danger" | "primary";
  title?: string;
  message?: string;
  yesText?: string;
  noText?: string;
  onYes: () => void;
  onNo: () => void;
  onAfterClose?: () => void;
};

export function ConfirmDialog({
  portalContainer,
  intent = "danger",
  open,
  title,
  message,
  yesText,
  noText,
  onYes,
  onNo,
  onAfterClose,
}: Props) {
  const { t } = useI18n();
  const DURATION = 200;
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const openRef = useRef(open); openRef.current = open;
  const afterCloseRef = useRef(onAfterClose); afterCloseRef.current = onAfterClose;

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  useEffect(() => {
    if (!open || !panel) return;
    let secondFrame = 0;
    // Start only after the portal has committed its hidden panel.
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => setVisible(true));
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [open, panel]);

  useEffect(() => {
    if (!open) setVisible(false);
  }, [open]);

  useEffect(() => {
    if (open || !mounted || visible || !panel) return;
    let finished = false;
    const finish = () => {
      if (finished || openRef.current) return;
      finished = true;
      setMounted(false);
      afterCloseRef.current?.();
    };
    const transitionEnd = (event: TransitionEvent) => {
      if (event.target === panel && event.propertyName === 'opacity') finish();
    };
    panel.addEventListener('transitionend', transitionEnd);
    // Read the exit styles after the closed state commits, including reduced motion.
    const style = window.getComputedStyle(panel);
    const time = (value: string) => (parseFloat(value) || 0) * (value.trim().endsWith('ms') ? 1 : 1000);
    const delays = style.transitionDelay.split(',').map(time);
    const duration = style.transitionDuration ? Math.max(...style.transitionDuration.split(',').map((value, index) => time(value) + delays[index % delays.length])) : DURATION;
    const timer = window.setTimeout(finish, duration === 0 ? 0 : duration + 50);
    return () => { window.clearTimeout(timer); panel.removeEventListener('transitionend', transitionEnd); };
  }, [open, mounted, visible, panel]);

  if (!mounted) return null;

  return createPortal(
    (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center popupMotionLayer ${
        visible ? "opacity-100" : "opacity-0"
      }`}
      role="dialog"
      aria-modal="true"
      onMouseDown={open ? onNo : undefined}
    >
      <div
        className="absolute inset-0 bg-(--seethroughtBlack)"
      />

      <div
        ref={setPanel}
        className={`relative w-[min(520px,90vw)] rounded-3xl bg-(--background1) border border-(--border1) p-6 shadow-lg shadow-(color:--seethroughtBlack)
        popupMotionPanel
        ${visible ? "isOpen" : ""}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold">{title ?? t("adminConfirmTitle")}</h3>
        <p className="mt-2">{message ?? t("adminConfirmMessage")}</p>

        <div className="mt-5 flex justify-end gap-2 max-[400px]:flex-col">
          <button
            type="button"
            onClick={open ? onNo : undefined}
            className="button px-4 py-2 cursor-pointer rounded-full bg-(--background2) hover:bg-(--background3) max-[400px]:w-full"
          >
            {noText ?? t("adminNo")}
          </button>
          <button
            type="button"
            onClick={open ? onYes : undefined}
            className={`button px-4 py-2 cursor-pointer rounded-full max-[400px]:w-full ${intent === "primary" ? "bg-(--accentBlue) text-(--seeThroughtWhite)" : "bg-(--accentRed) text-(--text1)"}`}
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
