import { useEffect, useRef, type ReactNode } from "react";
import { setupSettingsSheetDrag } from "~/components/playPage/playerCollection/settingsSheetDrag";
import "./rowActionSheet.css";

export default function RowActionSheet({ label, open, visible, onClose, className = "", children }: {
  label: string;
  open: boolean;
  visible: boolean;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!open || !sheet) return;
    sheet.style.removeProperty("--sheet-drag-y");
    sheet.removeAttribute("data-dragging");
    return setupSettingsSheetDrag(sheet, () => closeRef.current(), () => true);
  }, [open]);

  return <div ref={sheetRef} role="dialog" aria-modal="true" aria-label={label}
    className={`rowActionSheet relative w-full max-w-lg rounded-t-3xl bg-(--background1) pb-safe popupMotionPanel ${visible ? "isOpen" : ""} ${className}`}
    onClick={event => event.stopPropagation()}>
    <div className="rowActionSheetHandle sheet-header" aria-hidden="true"><span /></div>
    {children}
  </div>;
}
