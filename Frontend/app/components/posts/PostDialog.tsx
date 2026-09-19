import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '~/i18n';
import { CloseSVG } from '~/constants';
import './posts.css';

export default function PostDialog({ title, onClose, children, busy = false, className = '' }: { className?: string; title: string; onClose: () => void; busy?: boolean; children: ReactNode | ((close: () => void) => ReactNode) }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const pressedBackdrop = useRef(false);
  const closing = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [visible, setVisible] = useState(false);
  const titleId = useId();
  const isOutside = (dialog: HTMLDialogElement, x: number, y: number) => {
    const rect = dialog.getBoundingClientRect();
    return x < rect.left || x > rect.right || y < rect.top || y > rect.bottom;
  };
  const close = () => {
    if (closing.current || busyRef.current) return;
    closing.current = true;
    setVisible(false);
    closeTimer.current = setTimeout(onClose, 200);
  };
  useEffect(() => {
    const element = ref.current;
    const focused = document.activeElement as HTMLElement | null;
    element?.showModal();
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => { if (!closing.current) setVisible(true); });
    });
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      if (closeTimer.current !== null) clearTimeout(closeTimer.current);
      element?.close();
      document.body.style.overflow = overflow;
      focused?.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(<dialog ref={ref} className={`postDialog customSelectMenuScroll ${className}`} data-visible={visible} aria-labelledby={titleId} aria-busy={busy}
    onCancel={event => { event.preventDefault(); close(); }}
    onPointerDown={event => {
      pressedBackdrop.current = event.button === 0 && event.target === event.currentTarget && isOutside(event.currentTarget, event.clientX, event.clientY);
    }}
    onPointerCancel={() => { pressedBackdrop.current = false; }}
    onClick={event => {
      const clickedBackdrop = pressedBackdrop.current && event.target === event.currentTarget && isOutside(event.currentTarget, event.clientX, event.clientY);
      pressedBackdrop.current = false;
      if (clickedBackdrop) close();
    }}>
    <div className="postDialogHeading"><h2 id={titleId}>{title}</h2><button type="button" className="postIconButton" aria-label={t('close')} disabled={busy} onClick={close}>{CloseSVG}</button></div>
    {typeof children === 'function' ? children(close) : children}
  </dialog>, document.body);
}

