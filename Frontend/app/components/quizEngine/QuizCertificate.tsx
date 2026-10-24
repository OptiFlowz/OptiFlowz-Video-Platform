import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { getToken } from '~/functions';
import { allCertificateTemplates } from './certificateApi';
import { useI18n } from '~/i18n';
import { useConfirm } from '~/components/confirmPopup/useConfirm';
import { ConfirmDialog } from '~/components/confirmPopup/confirmDialog';
import { LoadState, Notice, useAction, styles } from './shared';
import { engineKey, request } from './api';
import type { Quiz } from './model';
import { QuizSVG } from '~/constants';
import { CertificateHtmlPreview } from './CertificateTemplates';
import CertificateChooser from './CertificateChooser';

export default function QuizCertificate({ quiz, editable, onDirty }: { quiz: Quiz; editable: boolean; onDirty: (dirty: boolean) => void }) {
  const { t } = useI18n(), action = useAction(), navigate = useNavigate(), { confirm, dialogProps } = useConfirm();
  const [choosing, setChoosing] = useState(false);
  const [selected, setSelected] = useState(quiz.certificate_template_id ?? '');
  const [saved, setSaved] = useState(quiz.certificate_template_id ?? '');
  const dirty = selected !== saved;
  useEffect(() => {
    setSelected(quiz.certificate_template_id ?? '');
    setSaved(quiz.certificate_template_id ?? '');
  }, [quiz.certificate_template_id]);
  const token = getToken();
  const templates = useQuery({ queryKey: [...engineKey, token, 'certificate-templates'], enabled: !!token,
    queryFn: ({ signal }) => allCertificateTemplates(signal), retry: false });
  // The API returns system templates and the authenticated user's private designs,
  // including when that user is authorized to edit someone else's quiz.
  const available = templates.data ?? [];
  const template = available.find(template => template.id === selected);
  const unavailable = !!selected && !template;
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  const manage = async () => {
    if (dirty && !await confirm({ title: t('qeUnsaved'), message: t('qeDiscard'), yesText: t('qeDiscardAction'), noText: t('adminCancel') })) return;
    onDirty(false); navigate('/quizzes?tab=certificates');
  };
  return <div className={styles.certificateTab}>
    <LoadState query={templates} variant="inline" />
    {templates.isSuccess && <section className={`${styles.quizCertificatePreview} ${!template ? styles.quizCertificateEmpty : ''}`} aria-label={t('postPreview')}>
      <div className={styles.quizCertificateInfo}>
        {!template && <span className={styles.quizCertificateIcon} aria-hidden="true">{QuizSVG}</span>}
        <h2>{template?.name ?? t(unavailable ? 'quizCertificateUnavailable' : 'quizCertificateNone')}</h2>
        {template?.description && <p>{template.description}</p>}
        {template && <span className={styles.muted}>{template.page_format} · {t(template.orientation === 'portrait' ? 'quizCertificatePortrait' : 'quizCertificateLandscape')}</span>}
        {editable && <div className={styles.quizCertificateButtons}>
          <button type="button" className={`${styles.button} ${styles.primary}`} disabled={action.busy} onClick={() => setChoosing(true)}>{t('quizCertificateChoose')}</button>
          {selected && <button type="button" className={styles.button} disabled={action.busy} onClick={() => setSelected('')}>{t('quizRemove')}</button>}
        </div>}
      </div>
      {template && <div className={styles.quizCertificatePaper}><CertificateHtmlPreview template={template} /></div>}
    </section>}
    {choosing && <CertificateChooser templates={available} selected={selected} onClose={() => setChoosing(false)} onChoose={id => { setSelected(id); setChoosing(false); }} />}
    <Notice {...action} />
    <div className={styles.toolbar}>
      <button type="button" className={styles.button} disabled={action.busy} onClick={() => void manage()}>{t('quizCertificateLibrary')}</button>
      {editable && <button type="button" className={`${styles.button} ${styles.primary} ${styles.savePrimary}`} disabled={action.busy || !dirty || templates.isPending || templates.isError || unavailable} onClick={() => void action.run(async () => { const result = await request<{ quiz: Quiz }>(`/${quiz.id}`, 'PATCH', { certificate_template_id: selected || null }); setSaved(result.quiz.certificate_template_id ?? ''); setSelected(result.quiz.certificate_template_id ?? ''); onDirty(false); })}>{t(action.busy ? 'saving' : 'saveChanges')}</button>}
    </div>
    <ConfirmDialog {...dialogProps} />
  </div>;
}
