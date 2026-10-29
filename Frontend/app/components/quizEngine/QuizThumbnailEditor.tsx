import { useEffect, useRef, useState } from 'react';
import { DeleteSVG, UploadSVG } from '~/constants';
import { useI18n } from '~/i18n';
import { ConfirmDialog } from '~/components/confirmPopup/confirmDialog';
import { useConfirm } from '~/components/confirmPopup/useConfirm';
import { ThumbnailDropZone } from '~/components/shared/thumbnailDropZone';
import { FieldHelp, Notice, styles, useAction } from './shared';
import type { Quiz } from './model';
import QuizThumbnail from './QuizThumbnail';
import { uploadQuizThumbnail, validQuizThumbnail } from './quizThumbnailApi';
import css from './quizThumbnail.module.css';

export default function QuizThumbnailEditor({ quiz, editable, disabled }: { quiz?: Quiz; editable: boolean; disabled: boolean }) {
  const { t } = useI18n(), action = useAction(), input = useRef<HTMLInputElement>(null);
  const { confirm, dialogProps } = useConfirm();
  const [url, setUrl] = useState(quiz?.thumbnail_url);
  useEffect(() => setUrl(quiz?.thumbnail_url), [quiz?.thumbnail_url]);
  const blocked = !quiz || !editable || disabled || action.busy;
  const save = (file: File | null) => {
    if (blocked) return;
    if (file && !validQuizThumbnail(file)) { action.setError(t('postImageError')); return; }
    void action.run(async () => { const saved = await uploadQuizThumbnail(quiz.id, file); setUrl(saved.thumbnail_url); });
  };
  const remove = async () => {
    if (blocked || !url) return;
    if (await confirm({ title: t('removeThumbnail'), message: t('adminConfirmMessage'), yesText: t('adminDelete'), noText: t('adminCancel') })) save(null);
  };
  return <><ThumbnailDropZone as="div" className={css.editor} disabled={blocked} onFileSelect={save}>
    <QuizThumbnail src={url} size="preview" />
    <div className={css.controls}><div className={css.label}><h3>{t('thumbnail')}</h3><FieldHelp label={t('thumbnail')} help={t(quiz ? 'quizThumbnailHelp' : 'quizThumbnailSaveFirst')} /></div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" aria-label={t('selectThumbnailImage')} hidden disabled={blocked} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) save(file); }} />
      <div className={css.actions}><button type="button" className={styles.button} disabled={blocked} onClick={() => input.current?.click()}>{UploadSVG}{t(action.busy ? 'saving' : 'selectThumbnailImage')}</button>
        {url && <button type="button" className={`${styles.icon} ${styles.danger} ${css.remove}`} aria-label={t('removeThumbnail')} title={t('removeThumbnail')} disabled={blocked} onClick={() => void remove()}>{DeleteSVG}</button>}
      </div><Notice {...action} />
    </div>
  </ThumbnailDropZone><ConfirmDialog {...dialogProps} /></>;
}
