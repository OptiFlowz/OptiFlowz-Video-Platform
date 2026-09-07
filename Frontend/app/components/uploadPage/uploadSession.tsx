"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import dynamic from "next/dynamic";
import { useAuthorization } from "~/authorization/authorization";
import { getToken } from "~/functions";
const UploadPage = dynamic(() => import("./uploadPage"), { ssr: false });
import { UploadSVG } from "~/constants";
import { useI18n } from "~/i18n";
import styles from "./uploadStatus.module.css";

export type UploadStatus = { label: string; busy: boolean; hasDraft: boolean };
const UploadSlotContext = createContext<((slot: HTMLElement | null) => void) | null>(null);

// The portal target stays the same when moving between pages, so the upload,
// polling and unsaved editor state survive navigation within the application.
export function UploadSessionProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const { user } = useAuthorization();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<UploadStatus | null>(null);
  const attach = useCallback((slot: HTMLElement | null) => {
    setVisible(!!slot);
    let target = containerRef.current;
    if (!target && slot) {
      target = document.createElement("div");
      containerRef.current = target;
      setContainer(target);
    }
    if (target) {
      if (slot) slot.appendChild(target);
      else target.remove();
    }
  }, []);
  const finish = useCallback(() => {
    containerRef.current?.remove();
    containerRef.current = null;
    setContainer(null);
    setStatus(null);
  }, []);
  useEffect(() => {
    if (container && !getToken()) finish();
  }, [container, user, finish]);
  const reportStatus = useCallback((next: UploadStatus) => {
    setStatus((current) => current?.label === next.label && current.busy === next.busy && current.hasDraft === next.hasDraft ? current : next);
  }, []);

  return (
    <UploadSlotContext.Provider value={attach}>
      {children}
      {container && createPortal(<UploadPage onStatus={reportStatus} onFinish={finish} />, container)}
      {!visible && status?.hasDraft && (
        <Link to="/upload" className={styles.floating} aria-label={t("uploadReturnToDetails")}>
          {UploadSVG}
          <span><strong>{status.label || t("uploadDraft")}</strong><small>{t("uploadReturnToDetails")}</small></span>
        </Link>
      )}
    </UploadSlotContext.Provider>
  );
}

export function UploadSessionSlot() {
  const attach = useContext(UploadSlotContext);
  const slotRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    attach?.(slotRef.current);
    return () => attach?.(null);
  }, [attach]);
  return <div ref={slotRef} />;
}
