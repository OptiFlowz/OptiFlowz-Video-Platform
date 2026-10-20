import { createContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import PopupPortal from '~/components/popupPortal/popupPortal';
import { CloseSVG } from '~/constants';
import { useI18n } from '~/i18n';
import styles from './engine.module.css';

type Presentation = { title: string; description?: string; wide?: boolean };
export const EditorPresentationContext = createContext<((value: Presentation | null) => void) | undefined>(undefined);
export const EditorBusyStatusContext = createContext(false);
export const EditorBusyContext = createContext<((busy: boolean) => void) | undefined>(undefined);

/** Shared popup shell for the new engine, using the existing quiz popup motion and layout. */
export default function EditorPopup({ open, title, description, onClose, children, wide = false, compact = false }: {
  open: boolean; title: string; description?: string; onClose: () => void; children: ReactNode; wide?: boolean; compact?: boolean;
}) {
  const { t } = useI18n(), titleId = useId();
  const [mounted, setMounted] = useState(open), [visible, setVisible] = useState(false), [busy, setBusy] = useState(false);
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const panel = useRef<HTMLDivElement>(null), previousFocus = useRef<HTMLElement | null>(null);
  const retained = useRef({ title, description, children });
  if (open) retained.current = { title, description, children };
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    let first = 0, second = 0, timer = 0;
    if (open) {
      previousFocus.current = document.activeElement as HTMLElement;
      setMounted(true);
      first = requestAnimationFrame(() => { second = requestAnimationFrame(() => {
        setVisible(true); panel.current?.focus({ preventScroll: true });
      }); });
    } else { setVisible(false); timer = window.setTimeout(() => setMounted(false), 200); }
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); window.clearTimeout(timer); };
  }, [open]);
  useEffect(() => {
    if (!mounted) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = overflow; previousFocus.current?.focus({ preventScroll: true }); };
  }, [mounted]);
  useEffect(() => {
    if (!open) return;
    const keydown = (event: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[aria-modal="true"]');
      if (dialogs[dialogs.length - 1] !== panel.current || event.defaultPrevented) return;
      if (event.key === 'Escape' && !busy) { event.preventDefault(); close.current(); }
      if (event.key !== 'Tab') return;
      const elements = Array.from(panel.current!.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')).filter(element => element.getClientRects().length);
      const first = elements[0], last = elements[elements.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [open, busy]);
  if (!mounted) return null;
  return <PopupPortal><div className={`${styles.popupLayer} popupMotionLayer ${visible ? 'opacity-100' : 'opacity-0'}`} onMouseDown={event => { if (event.target === event.currentTarget && open && !busy) onClose(); }}>
    <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy} tabIndex={-1} className={`${styles.page} ${styles.popupPanel} ${compact ? styles.compactPopup : ""} ${(presentation?.wide ?? wide) ? styles.widePopup : ""} popupMotionPanel ${visible ? 'isOpen' : ''}`}>
      <div className={`quizPopupHeader ${styles.popupHeader}`}><div><h3 id={titleId}>{presentation?.title ?? retained.current.title}</h3>{(presentation?.description ?? retained.current.description) && <p>{presentation?.description ?? retained.current.description}</p>}</div><button type="button" className={styles.icon} aria-label={t('close')} disabled={busy || !open} onClick={onClose}>{CloseSVG}</button></div>
      <EditorPresentationContext.Provider value={setPresentation}><EditorBusyStatusContext.Provider value={busy}><EditorBusyContext.Provider value={setBusy}><div className={styles.popupContent}>{retained.current.children}</div></EditorBusyContext.Provider></EditorBusyStatusContext.Provider></EditorPresentationContext.Provider>
    </div>
  </div></PopupPortal>;
}
