import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '~/i18n';
import { AddSVG, AnalyticsSVG, ArrowForwardSVG, CheckSVG, CloseSVG, DeleteSVG, EditSVG, NotesSVG, PermissionEyeSVG, PlaySVG, PostImageSVG, PublicSVG, PrivateSVG, QuizSVG } from '~/constants';
import CustomSelect from '../customSelect/customSelect';
import type { ChannelVideoT } from '~/types';
import PostCard, { PostAuthorHeader, PostVideoPreview } from './PostCard';
import { blockTypes, newBlock, newId, validPost, type Post, type PostBlock, type PostAuthor } from './model';

import { savePost, type SaveSession } from './api';

const blockIcons = { text: NotesSVG, image: PostImageSVG, poll: AnalyticsSVG, questionnaire: QuizSVG, video: PlaySVG };

function InlineText({ value, label, onChange, maxLength = 10000 }: { value: string; label: string; onChange: (value: string) => void; maxLength?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const input = ref.current;
    if (!input) return;
    const resize = () => {
      input.style.height = 'auto';
      const style = getComputedStyle(input);
      const borders = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      input.style.height = `${input.scrollHeight + borders}px`;
    };
    resize();
    let width = input.clientWidth;
    const observer = new ResizeObserver(() => {
      if (input.clientWidth !== width) { width = input.clientWidth; resize(); }
    });
    observer.observe(input);
    return () => observer.disconnect();
  }, [value]);
  return <textarea ref={ref} className="postInlineText customSelectMenuScroll" rows={1} aria-label={label} placeholder={label} maxLength={maxLength} value={value} onChange={event => onChange(event.target.value)} />;
}

function ImageInput({ value, onChange, compact = false }: { value: string; onChange: (value: string) => void; compact?: boolean }) {
  const { t } = useI18n();
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  return <div className={`postComposerImage ${compact ? 'isCompact' : ''} ${value ? 'hasImage' : ''}`} aria-busy={busy}>
    {value && <img src={value} alt={t('postImage')} />}
    <div className="postComposerImageControls">
      <label className="postImageUpload" title={t('postChooseImage')}>
        {value ? EditSVG : PostImageSVG}<span className={compact ? 'sr-only' : ''}>{t('postChooseImage')}</span>
        <input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={event => {
          const file = event.target.files?.[0]; event.target.value = '';
          if (!file) return;
          if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) { setError(true); return; }
          setBusy(true); setError(false);
          const reader = new FileReader();
          reader.onload = () => { onChange(String(reader.result)); setBusy(false); };
          reader.onerror = () => { setError(true); setBusy(false); };
          reader.readAsDataURL(file);
        }} />
      </label>
      {value && <button type="button" className="postIconButton" disabled={busy} aria-label={t('adminDelete')} onClick={() => onChange('')}>{DeleteSVG}</button>}
    </div>
    {error && <p role="alert" className="postError">{t('postImageError')}</p>}
  </div>;
}

export function PostDialog({ title, onClose, children, busy = false }: { title: string; onClose: () => void; busy?: boolean; children: ReactNode | ((close: () => void) => ReactNode) }) {
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
  return createPortal(<dialog ref={ref} className="postDialog customSelectMenuScroll" data-visible={visible} aria-labelledby={titleId} aria-busy={busy}
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

export default function PostEditor({ post, author, videos, moreVideos, onClose, onSave }: { post: Post; author: PostAuthor; videos: ChannelVideoT[]; moreVideos?: ReactNode; onClose: () => void; onSave: (post: Post) => Promise<void> | void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<Post>(() => structuredClone(post));
  const session = useRef<SaveSession>({ current: post.persisted ? structuredClone(post) : undefined });
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState('');
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const [focusBlock, setFocusBlock] = useState<string>();
  const canvas = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!focusBlock) return;
    const section = Array.from(canvas.current?.querySelectorAll<HTMLElement>('[data-block-id]') ?? []).find(item => item.dataset.blockId === focusBlock);
    section?.querySelector<HTMLTextAreaElement>('textarea')?.focus({ preventScroll: true });
    section?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    setFocusBlock(undefined);
  }, [focusBlock]);
  const update = (id: string, value: PostBlock) => setDraft(current => ({ ...current, blocks: current.blocks.map(block => block.id === id ? value : block) }));
  const move = (index: number, direction: number) => setDraft(current => {
    const blocks = [...current.blocks]; [blocks[index], blocks[index + direction]] = [blocks[index + direction], blocks[index]];
    return { ...current, blocks };
  });
  const add = (type: PostBlock['type'], index: number) => {
    if (draft.blocks.length >= 50) return;
    const block = newBlock(type);
    setDraft(current => ({ ...current, blocks: [...current.blocks.slice(0, index), block, ...current.blocks.slice(index)] }));
    setInsertAt(null); setFocusBlock(block.id);
  };
  const addMenu = (index: number) => <div className="postComposerAddMenu" aria-label={t('postAddBlock')}>
    {blockTypes.map(type => <button key={type} type="button" disabled={draft.blocks.length >= 50} onClick={() => add(type, index)}>{blockIcons[type]}{t(`postType_${type}`)}</button>)}
  </div>;
  return <PostDialog title={t('postEditor')} onClose={onClose} busy={saving}>{close => <>
    <div className="postComposerToolbar">
      <div className="postEditorTabs"><button type="button" aria-pressed={!preview} onClick={() => setPreview(false)}>{EditSVG}{t('adminEdit')}</button><button type="button" aria-pressed={preview} onClick={() => setPreview(true)}>{PermissionEyeSVG}{t('postPreview')}</button></div>
    </div>
    <form className="postEditorForm postComposerForm" onSubmit={async event => {
      event.preventDefault(); if (savingRef.current) return; setError('');
      if (!validPost(draft)) { setPreview(false); setError(t('postValidation')); return; }
      savingRef.current = true; setSaving(true);
      try {
        const saved = await savePost(draft, session.current, setDraft);
        await onSave(saved);
        savingRef.current = false; setSaving(false);
        // Let the dialog receive the unlocked state before starting its closing animation.
        requestAnimationFrame(close);
      } catch (error) { setError(`${t('postSaveError')} ${error instanceof Error ? error.message : ''}`); }
      finally { savingRef.current = false; setSaving(false); }
    }}>
      <fieldset className="postEditorFields" disabled={saving}>
      {preview ? <PostCard post={draft} author={author} videos={videos} /> : <>
        <label className="postComposerTitle">{t('title')}<input maxLength={255} placeholder={t('title')} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
        <article className="postCard postComposer" ref={canvas} aria-label={t('postEditor')}>
          <PostAuthorHeader author={author} createdAt={draft.createdAt}>
            <div className="postComposerStatus"><CustomSelect value={draft.status} ariaLabel={t('adminTableStatus')} leadingContent={draft.status === 'public' ? PublicSVG : PrivateSVG} options={['private', 'public'].map(value => ({ value, label: t(`postStatus_${value}`) }))} onChange={value => setDraft({ ...draft, status: value as Post['status'] })} /></div>
          </PostAuthorHeader>
          <div className="postComposerBlocks">{draft.blocks.map((block, index) => <Fragment key={block.id}>
            <section className={`postComposerSection postComposerSection-${block.type}`} data-block-id={block.id} aria-label={t(`postType_${block.type}`)}>
              <div className="postComposerSectionTools"><span>{blockIcons[block.type]}{t(`postType_${block.type}`)}</span><div className="postBlockActions">
                <button type="button" disabled={index === 0} title={t('postMoveUp')} aria-label={t('postMoveUp')} onClick={() => move(index, -1)}><span className="postArrowUp">{ArrowForwardSVG}</span></button>
                <button type="button" disabled={index === draft.blocks.length - 1} title={t('postMoveDown')} aria-label={t('postMoveDown')} onClick={() => move(index, 1)}><span className="postArrowDown">{ArrowForwardSVG}</span></button>
                <button type="button" title={t('adminDelete')} aria-label={t('adminDelete')} onClick={() => { setDraft(current => ({ ...current, blocks: current.blocks.filter(item => item.id !== block.id) })); setInsertAt(null); }}>{DeleteSVG}</button>
              </div></div>
              <fieldset disabled={!!block.hasResponses} className={block.type === 'text' || block.type === 'image' ? 'postInset postSectionFields' : 'postComposerSectionContent postSectionFields'}>
                {block.hasResponses && <p className="postPollFeedback">{t('postResponsesLocked')}</p>}
                <InlineText value={block.text} label={t(block.type === 'poll' || block.type === 'questionnaire' ? 'postQuestion' : 'postText')} onChange={text => update(block.id, { ...block, text })} />
                {block.type === 'image' && <ImageInput value={block.image} onChange={image => update(block.id, { ...block, image })} />}
                {block.type === 'video' && <div className="postComposerVideo">
                  <CustomSelect value={block.videoId} ariaLabel={t('postSelectVideo')} options={[{ value: '', label: t('postSelectVideo'), disabled: true }, ...(block.videoId && !videos.some(video => video.id === block.videoId) ? [{ value: block.videoId, label: block.video?.title || t('postSelectedVideo') }] : []), ...videos.map(video => ({ value: video.id, label: video.title }))]} onChange={videoId => update(block.id, { ...block, videoId, video: videos.find(item => item.id === videoId) })} />
                  {block.videoId && <PostVideoPreview video={videos.find(video => video.id === block.videoId) ?? block.video} videoId={block.videoId} />}{moreVideos}
                </div>}
                {(block.type === 'poll' || block.type === 'questionnaire') && <div className="postOptions postComposerOptions">
                  {block.options.map((option, optionIndex) => <div className={`postComposerOption ${block.type === 'questionnaire' && block.correctIds?.includes(option.id) ? 'isCorrect' : ''}`} key={option.id}>
                    <div className="postComposerOptionRow">
                      {block.type === 'questionnaire' ? <label className="postCorrectChoice" title={t('postCorrectAnswer')}>
                        <input className="sr-only" type="checkbox" name={`correct-${block.id}`} aria-label={`${t('postCorrectAnswer')}: ${option.text || `${t('postOption')} ${optionIndex + 1}`}`} checked={!!block.correctIds?.includes(option.id)} onChange={() => update(block.id, { ...block, correctIds: block.correctIds?.includes(option.id) ? block.correctIds.filter(id => id !== option.id) : [...(block.correctIds || []), option.id] })} />
                        <span aria-hidden="true">{block.correctIds?.includes(option.id) && CheckSVG}</span>
                      </label> : <span className="postOptionDot" aria-hidden="true" />}
                      <ImageInput compact value={option.image || ''} onChange={image => update(block.id, { ...block, options: block.options.map(item => item.id === option.id ? { ...item, image } : item) })} />
                      <InlineText maxLength={500} label={`${t('postOption')} ${optionIndex + 1}`} value={option.text} onChange={text => update(block.id, { ...block, options: block.options.map(item => item.id === option.id ? { ...item, text } : item) })} />
                      <button type="button" className="postIconButton" disabled={block.options.length <= 2} aria-label={`${t('adminDelete')}: ${t('postOption')} ${optionIndex + 1}`} onClick={() => update(block.id, { ...block, correctIds: block.correctIds?.filter(id => id !== option.id), options: block.options.filter(item => item.id !== option.id) })}>{CloseSVG}</button>
                    </div>
                    {block.type === 'questionnaire' && block.correctIds?.includes(option.id) && <small className="postComposerCorrectLabel">{t('postCorrectAnswer')}</small>}
                  </div>)}
                  <div className="postComposerOptionFooter"><button className="postComposerAddOption" type="button" disabled={block.options.length >= 20} onClick={() => update(block.id, { ...block, options: [...block.options, { id: newId(), text: '', votes: 0 }] })}>{AddSVG}{t('postAddOption')}</button>
                    {block.type === 'questionnaire' && <span>{t('postChooseCorrect')}</span>}
                  </div>
                </div>}
              </fieldset>
            </section>
            {index < draft.blocks.length - 1 && <div className="postComposerInsert">
              <button type="button" disabled={draft.blocks.length >= 50} aria-label={t('postAddBlock')} title={t('postAddBlock')} aria-expanded={insertAt === index + 1} onClick={() => setInsertAt(insertAt === index + 1 ? null : index + 1)}>{insertAt === index + 1 ? CloseSVG : AddSVG}</button>
              {insertAt === index + 1 && addMenu(index + 1)}
            </div>}
          </Fragment>)}</div>
          <div className="postComposerAdd"><span>{AddSVG}{t('postAddBlock')}</span>{addMenu(draft.blocks.length)}</div>
        </article>
      </>}
      </fieldset>
      {error && <p role="alert" className="postError">{error}</p>}
      <div className="postEditorFooter"><button type="button" className="postSecondary" disabled={saving} onClick={close}>{t('adminCancel')}</button><button type="submit" className="postPrimary" disabled={saving}>{saving && <span className="uploadSpinner tiny" />}{t(saving ? 'postSaving' : 'adminSave')}</button></div>
    </form>
  </>}</PostDialog>;
}
