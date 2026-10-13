import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthorization } from '~/authorization/authorization';
import { P } from '~/authorization/permissions';
import { PrivateSVG, PublicSVG } from '~/constants';
import { useI18n } from '~/i18n';
import { usePopupPresence } from '~/hooks/usePopupPresence';
import RowActionSheet from '~/components/library/rowActionSheet';
import { updateCollectionVisibility } from './api';
import type { Collection } from './model';

export default function CollectionVisibility({ collection, disabled = false }: { collection: Collection; disabled?: boolean }) {
  const { t } = useI18n();
  const { canOwn } = useAuthorization();
  const client = useQueryClient();
  const canEdit = canOwn(P.collectionsUpdateOwn, P.collectionsUpdateAny, collection.created_by);
  const [open, setOpen] = useState(false), [mobile, setMobile] = useState(false);
  const presence = usePopupPresence(open);
  const [draft, setDraft] = useState(collection.visibility);
  const [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({ position: 'fixed' });
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const pending = useRef(false);
  const dialogId = useId();
  const close = () => { if (!pending.current) setOpen(false); };

  useEffect(() => {
    const media = window.matchMedia('(max-width: 768px)');
    const update = () => setMobile(media.matches);
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => { if (!canEdit || disabled) setOpen(false); }, [canEdit, disabled]);
  useLayoutEffect(() => {
    if (!presence.mounted || mobile) return;
    const reposition = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = 250, padding = 12, gap = 8;
      const height = panel.current?.offsetHeight || 170;
      setPosition({ position: 'fixed', width, left: Math.max(padding, Math.min(rect.left, window.innerWidth - width - padding)),
        top: rect.bottom + gap + height > window.innerHeight - padding ? Math.max(padding, rect.top - height - gap) : rect.bottom + gap });
    };
    reposition(); window.addEventListener('resize', reposition); window.addEventListener('scroll', reposition, true);
    return () => { window.removeEventListener('resize', reposition); window.removeEventListener('scroll', reposition, true); };
  }, [presence.mounted, mobile, error]);
  useEffect(() => {
    if (!open || !presence.mounted) return;
    const button = trigger.current;
    const overflow = document.body.style.overflow;
    if (mobile) document.body.style.overflow = 'hidden';
    panel.current?.querySelector<HTMLInputElement>('input:checked')?.focus({ preventScroll: true });
    const outside = (event: MouseEvent) => {
      if (!panel.current?.contains(event.target as Node) && !button?.contains(event.target as Node)) close();
    };
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(panel.current?.querySelectorAll<HTMLElement>('input:checked:not(:disabled), button:not(:disabled)') || []);
      const first = focusable[0], last = focusable.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus({ preventScroll: true }); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus({ preventScroll: true }); }
    };
    document.addEventListener('mousedown', outside); document.addEventListener('keydown', keys);
    return () => {
      document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', keys);
      if (mobile) document.body.style.overflow = overflow;
      if (button?.isConnected) button.focus({ preventScroll: true });
    };
  }, [open, presence.mounted, mobile]);

  async function save() {
    if (pending.current || disabled || !canEdit) return;
    if (draft === collection.visibility) { close(); return; }
    pending.current = true; setBusy(true); setError(false);
    try {
      // Patch only visibility, so a concurrent title/description edit is preserved.
      await updateCollectionVisibility(collection.id, draft);
      await client.invalidateQueries({ queryKey: ['collections'] });
      setOpen(false);
    } catch { setError(true); }
    finally { pending.current = false; setBusy(false); }
  }
  const label = <>{collection.visibility === 'public' ? PublicSVG : PrivateSVG}&nbsp;{t(collection.visibility === 'public' ? 'adminPublic' : 'adminPrivate')}</>;
  const content = <>
    {mobile && <h3 className="px-4 pb-2 text-base font-semibold">{t('adminChangeVisibility')}</h3>}
    <fieldset disabled={busy} className={`flex flex-col gap-2 ${mobile ? 'px-4 py-2' : ''}`} aria-label={t('adminChangeVisibility')}>
      {(['public', 'private'] as const).map(value => <label key={value} className="flex items-center gap-2 cursor-pointer">
        <input type="radio" name={dialogId} value={value} checked={draft === value} onChange={() => setDraft(value)}
          className="appearance-none rounded-full! p-3! border! border-(--border1)! cursor-pointer bg-(--background2) checked:bg-(--accentOrange)! transition-colors relative checked:after:content-['✓'] checked:after:absolute checked:after:text-(--text1) checked:after:text-sm checked:after:left-1/2 checked:after:top-1/2 checked:after:-translate-x-1/2 checked:after:-translate-y-1/2" />
        <span className="visibilityOptionIcon">{value === 'public' ? PublicSVG : PrivateSVG}</span>{t(value === 'public' ? 'adminPublic' : 'adminPrivate')}
      </label>)}
    </fieldset>
    {error && <p role="alert" className="errorBanner mt-3">{t('collectionSaveFailed')}</p>}
    <div className={`flex justify-end gap-2 ${mobile ? 'px-4 pb-4 pt-3' : 'mt-3'}`}>
      <button type="button" disabled={busy} onClick={close} className="rounded-full border border-(--border1) bg-(--background2) hover:bg-(--background3) px-4 py-1.5 text-sm cursor-pointer disabled:opacity-50">{t('adminCancel')}</button>
      <button type="button" disabled={busy} onClick={() => void save()} className="rounded-full text-(--text1) bg-(--accentBlue) hover:bg-(--accentBlue2) px-4 py-1.5 text-sm cursor-pointer disabled:opacity-50">{t(busy ? 'saving' : 'adminSave')}</button>
    </div>
  </>;
  return <>
    {canEdit ? <button ref={trigger} type="button" className={`visibility collectionVisibility ${collection.visibility}`} disabled={disabled || busy}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? dialogId : undefined} title={t('adminChangeVisibility')}
      onClick={() => { setDraft(collection.visibility); setError(false); setOpen(true); }}>{label}</button>
      : <span className={`visibility collectionVisibility ${collection.visibility}`}>{label}</span>}
    {presence.mounted && canEdit && typeof document !== 'undefined' && createPortal(mobile ?
      <div ref={panel} inert={!open} className={`fixed inset-0 z-[1000000000] flex items-end justify-center popupMotionLayer ${presence.visible ? 'isOpen' : ''}`} onClick={event => { if (event.target === event.currentTarget) close(); }}>
        <div className="absolute inset-0 bg-(--seethroughtBlack)" onClick={close} />
        <RowActionSheet label={t('adminChangeVisibility')} open={open} visible={presence.visible} onClose={close}><div id={dialogId}>{content}</div></RowActionSheet>
      </div> :
      <div ref={panel} inert={!open} id={dialogId} role="dialog" aria-modal="true" aria-label={t('adminChangeVisibility')} style={position}
        className={`rowVisibilityPopup z-[1000000000] rounded-2xl border! border-(--border1)! bg-(--background1) p-3 shadow-2xl shadow-(color:--seethroughtBlack) popupMotionPanel ${presence.visible ? 'isOpen' : ''}`}>{content}</div>, document.body)}
  </>;
}
