"use client";

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckSVG } from '~/constants';
import styles from './toast.module.css';

const eventName = 'app:toast';
type ToastMessage = { message: string; duration: number };

/** Show a brief confirmation without moving page content. Mount ToastHost once in the app shell. */
export function showToast(message: string, duration = 3000) {
  if (typeof window !== 'undefined' && message.trim()) {
    window.dispatchEvent(new window.CustomEvent<ToastMessage>(eventName, { detail: { message, duration } }));
  }
}

export function ToastHost() {
  const [mounted, setMounted] = useState(false);
  const [toast, setToast] = useState<(ToastMessage & { id: number }) | null>(null);
  const sequence = useRef(0);
  useEffect(() => {
    setMounted(true);
    let timer: number | undefined;
    const show = (event: Event) => {
      const detail = (event as CustomEvent<ToastMessage>).detail;
      window.clearTimeout(timer);
      setToast({ ...detail, id: ++sequence.current });
      timer = window.setTimeout(() => setToast(null), detail.duration);
    };
    window.addEventListener(eventName, show);
    return () => { window.removeEventListener(eventName, show); window.clearTimeout(timer); };
  }, []);
  return mounted ? createPortal(<div className={styles.host} role="status" aria-live="polite" aria-atomic="true">
    {toast && <div key={toast.id} className={styles.toast}><span aria-hidden="true">{CheckSVG}</span>{toast.message}</div>}
  </div>, document.body) : null;
}
