"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { CheckSVG } from '~/constants';
import styles from './toast.module.css';

const eventName = 'app:toast';
type ToastMessage = { id: number; message: string; duration: number; loading: boolean };
type ToastEvent = { action: 'show' | 'update' | 'dismiss'; toast: ToastMessage };
type ToastDisplay = { toast: ToastMessage; previous: ToastMessage | null; revision: number; exiting: boolean };
let sequence = 0;

function dispatch(action: ToastEvent['action'], toast: ToastMessage) {
  if (typeof window !== 'undefined') window.dispatchEvent(new window.CustomEvent<ToastEvent>(eventName, { detail: { action, toast } }));
}

/** Show a brief confirmation without moving page content. Mount ToastHost once in the app shell. */
export function showToast(message: string, duration = 2000) {
  if (typeof window !== 'undefined' && message.trim()) {
    dispatch('show', { id: ++sequence, message, duration, loading: false });
  }
}

/** Keep the same notification visible until its action and refresh have finished. */
export function startToast(message: string) {
  const toast = { id: ++sequence, message, duration: 0, loading: true };
  dispatch('show', toast);
  return {
    success: (message: string) => dispatch('update', { ...toast, message, duration: 2000, loading: false }),
    dismiss: () => dispatch('dismiss', toast),
  };
}

function Content({ toast, leaving = false, contentRef }: { toast: ToastMessage; leaving?: boolean; contentRef?: Ref<HTMLSpanElement> }) {
  return <span ref={contentRef} className={`${styles.content} ${leaving ? styles.leaving : styles.entering}`} aria-hidden={leaving || undefined}>
    <span className={styles.icon} aria-hidden="true">{toast.loading ? <span className="uploadSpinner tiny" /> : CheckSVG}</span><span>{toast.message}</span>
  </span>;
}

function ToastBubble({ display, onExited }: { display: ToastDisplay; onExited: () => void }) {
  const shell = useRef<HTMLDivElement>(null), content = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false), [width, setWidth] = useState<number>();
  useLayoutEffect(() => {
    const node = content.current, bubble = shell.current;
    if (!node || !bubble) return;
    // Measure the new message independently of the shell's animated width and outgoing text.
    const measure = () => {
      const style = window.getComputedStyle(bubble);
      const edges = [style.paddingLeft, style.paddingRight, style.borderLeftWidth, style.borderRightWidth].reduce((sum, value) => sum + (parseFloat(value) || 0), 0);
      setWidth(node.getBoundingClientRect().width + edges);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(node);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [display.revision]);
  useEffect(() => {
    if (display.exiting) {
      setVisible(false);
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const timer = window.setTimeout(onExited, reduced ? 0 : 280);
      return () => window.clearTimeout(timer);
    }
    let second = 0;
    const first = window.requestAnimationFrame(() => { second = window.requestAnimationFrame(() => setVisible(true)); });
    return () => { window.cancelAnimationFrame(first); window.cancelAnimationFrame(second); };
  }, [display.exiting, onExited]);
  return <div ref={shell} className={`${styles.toast} ${visible ? styles.visible : ''}`} style={{ width }} data-loading={display.toast.loading} data-exiting={display.exiting} aria-hidden={display.exiting || undefined}
    onTransitionEnd={event => { if (display.exiting && event.target === event.currentTarget && event.propertyName === 'transform') onExited(); }}>
    {display.previous && <Content key={`previous-${display.revision}`} toast={display.previous} leaving />}
    <Content key={display.revision} toast={display.toast} contentRef={content} />
  </div>;
}

export function ToastHost() {
  const [mounted, setMounted] = useState(false);
  const [display, setDisplay] = useState<ToastDisplay | null>(null);
  const current = useRef<ToastMessage | null>(null);
  const onExited = useCallback(() => setDisplay(value => value?.exiting ? null : value), []);
  useEffect(() => {
    setMounted(true);
    let timer: number | undefined, fadeTimer: number | undefined, revision = 0;
    const close = () => { current.current = null; setDisplay(value => value && { ...value, exiting: true }); };
    const show = (event: Event) => {
      const { action, toast } = (event as CustomEvent<ToastEvent>).detail;
      if (action !== 'show' && current.current?.id !== toast.id) return;
      window.clearTimeout(timer); window.clearTimeout(fadeTimer);
      const previous = current.current && (current.current.message !== toast.message || current.current.loading !== toast.loading) ? current.current : null;
      if (action === 'dismiss') { close(); return; }
      current.current = toast;
      const nextRevision = ++revision;
      setDisplay({ toast, previous, revision: nextRevision, exiting: false });
      if (previous) fadeTimer = window.setTimeout(() => setDisplay(value => value?.revision === nextRevision ? { ...value, previous: null } : value), 180);
      if (!toast.loading) timer = window.setTimeout(close, toast.duration);
    };
    window.addEventListener(eventName, show);
    return () => { window.removeEventListener(eventName, show); window.clearTimeout(timer); window.clearTimeout(fadeTimer); };
  }, []);
  return mounted ? createPortal(<div className={styles.host} role="status" aria-live="polite" aria-atomic="true">
    {display && <ToastBubble display={display} onExited={onExited} />}
  </div>, document.body) : null;
}
