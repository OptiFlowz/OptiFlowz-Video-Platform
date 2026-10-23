import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useI18n } from '~/i18n';
import { useConfirm } from '~/components/confirmPopup/useConfirm';
import { ConfirmDialog } from '~/components/confirmPopup/confirmDialog';
import { Notice, useAction, styles } from './shared';
import { request } from './api';
import type { Quiz } from './model';

export default function QuizCertificate({ quiz, editable, onDirty }: { quiz: Quiz; editable: boolean; onDirty: (dirty: boolean) => void }) {
  const { t } = useI18n(), action = useAction(), navigate = useNavigate(), { confirm, dialogProps } = useConfirm();
  const [enabled, setEnabled] = useState(quiz.has_certificate);
  const dirty = enabled !== quiz.has_certificate;
  useEffect(() => { setEnabled(quiz.has_certificate); }, [quiz.has_certificate]);
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  const manage = async () => {
    if (dirty && !await confirm({ title: t('qeUnsaved'), message: t('qeDiscard'), yesText: t('qeDiscardAction'), noText: t('adminCancel') })) return;
    onDirty(false); navigate('/quizzes?tab=certificates');
  };
  return <div className={styles.certificateTab}>
    <p className={styles.sectionHelp}>{t('quizCertificateSetupHelp')}</p>
    <label className={`quizPopupToggleRow ${styles.check} ${styles.certificateToggle}`}>
      <div><strong>{t('quizHasCertificate')}</strong><span>{t('quizCertificateEnabledHelp')}</span></div>
      <input type="checkbox" checked={enabled} disabled={!editable || action.busy} onChange={event => setEnabled(event.target.checked)} />
    </label>
    <Notice {...action} />
    <div className={styles.toolbar}>
      <button type="button" className={styles.button} disabled={action.busy} onClick={() => void manage()}>{t('quizCertificateLibrary')}</button>
      {editable && <button type="button" className={`${styles.button} ${styles.primary}`} disabled={action.busy || !dirty} onClick={() => void action.run(async () => { await request(`/${quiz.id}`, 'PATCH', { has_certificate: enabled }); onDirty(false); })}>{t(action.busy ? 'saving' : 'saveChanges')}</button>}
    </div>
    <ConfirmDialog {...dialogProps} />
  </div>;
}
