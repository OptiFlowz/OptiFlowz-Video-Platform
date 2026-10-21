import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import PopupPortal from '~/components/popupPortal/popupPortal';
import { CloseSVG } from '~/constants';
import { useI18n } from '~/i18n';
import styles from './engine.module.css';
import { lockEditorPageScroll } from './scrollLock';

type Presentation = { title: string; description?: string; wide?: boolean };
export const EditorPresentationContext = createContext<((value: Presentation | null) => void) | undefined>(undefined);
export const EditorBusyStatusContext = createContext(false);
export const EditorBusyContext = createContext<((busy: boolean) => void) | undefined>(undefined);
export const EditorNoticeContext = createContext<HTMLElement | null | undefined>(undefined);
const EditorNoticeTargetContext = createContext<((target: HTMLDivElement | null) => void) | undefined>(undefined);

/** Place popup feedback beside its actions, outside the scrolling content. */
export function EditorActions({ children, className = '' }: { children: ReactNode; className?: string }) {
  const registerNoticeTarget = useContext(EditorNoticeTargetContext);
  return <div className={`quizPopupActions ${className}`}>{registerNoticeTarget && <div ref={registerNoticeTarget} className={styles.popupNotice} />}{children}</div>;
}

/** Shared popup shell for the new engine, using the existing quiz popup motion and layout. */
export default function EditorPopup({ open, title, description, onClose, onAfterClose, children, wide = false, compact = false, className = '' }: {
  open: boolean; title: string; description?: string; onClose: () => void; onAfterClose?: () => void; children: ReactNode; wide?: boolean; compact?: boolean; className?: string;
}) {
  const { t } = useI18n(), titleId = useId();
  const [mounted, setMounted] = useState(open), [visible, setVisible] = useState(false), [busy, setBusy] = useState(false);
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const [noticeTarget, setNoticeTarget] = useState<HTMLDivElement | null>(null);
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const retained = useRef({ title, description, children });
  if (open) retained.current = { title, description, children };
  const close = useRef(onClose); close.current = onClose;
  const afterClose = useRef(onAfterClose); afterClose.current = onAfterClose;
  useEffect(() => {
    if (open) {
      if (!previousFocus.current) previousFocus.current = document.activeElement as HTMLElement;
      setMounted(true);
    }
  }, [open]);
  useEffect(() => {
    if (!open || !panel) return;
    // The portal must have committed its hidden panel before starting the transition.
    let second = 0;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => {
      setVisible(true); panel.focus({ preventScroll: true });
    }); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [open, panel]);
  useEffect(() => {
    if (open || !mounted) return;
    setVisible(false);
    const timer = window.setTimeout(() => { setMounted(false); afterClose.current?.(); }, 200);
    return () => window.clearTimeout(timer);
  }, [open, mounted]);
  useEffect(() => {
    if (!mounted) return;
    const unlock = lockEditorPageScroll();
    return () => { unlock(); previousFocus.current?.focus({ preventScroll: true }); previousFocus.current = null; };
  }, [mounted]);
  useEffect(() => {
    if (!open || !panel) return;
    const keydown = (event: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[aria-modal="true"]');
      if (dialogs[dialogs.length - 1] !== panel || event.defaultPrevented) return;
      if (event.key === 'Escape' && !busy) { event.preventDefault(); close.current(); }
      if (event.key !== 'Tab') return;
      const elements = Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')).filter(element => element.getClientRects().length);
      const first = elements[0], last = elements[elements.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel)) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [open, busy, panel]);
  if (!mounted) return null;
  return <PopupPortal><div className={`${styles.popupLayer} popupMotionLayer ${visible ? 'opacity-100' : 'opacity-0'}`} onMouseDown={event => { if (event.target === event.currentTarget && open && !busy) onClose(); }}>
    <div ref={setPanel} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy} tabIndex={-1} className={`${styles.page} ${styles.popupPanel} ${compact ? styles.compactPopup : ""} ${(presentation?.wide ?? wide) ? styles.widePopup : ""} ${className} popupMotionPanel ${visible ? 'isOpen' : ''}`}>
      <div className={`quizPopupHeader ${styles.popupHeader}`}><div><h3 id={titleId}>{presentation?.title ?? retained.current.title}</h3>{(presentation?.description ?? retained.current.description) && <p>{presentation?.description ?? retained.current.description}</p>}</div><button type="button" className={styles.icon} aria-label={t('close')} disabled={busy || !open} onClick={onClose}>{CloseSVG}</button></div>
      <EditorNoticeContext.Provider value={noticeTarget}><EditorNoticeTargetContext.Provider value={setNoticeTarget}><EditorPresentationContext.Provider value={setPresentation}><EditorBusyStatusContext.Provider value={busy}><EditorBusyContext.Provider value={setBusy}><div className={styles.popupContent}>{retained.current.children}</div></EditorBusyContext.Provider></EditorBusyStatusContext.Provider></EditorPresentationContext.Provider></EditorNoticeTargetContext.Provider></EditorNoticeContext.Provider>
    </div>
  </div></PopupPortal>;
}
