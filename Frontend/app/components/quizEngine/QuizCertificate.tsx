import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '~/i18n';
import { getToken } from '~/functions';
import { AddSVG } from '~/constants';
import Pagination from '~/components/library/pagination';
import { useConfirm } from '~/components/confirmPopup/useConfirm';
import { ConfirmDialog } from '~/components/confirmPopup/confirmDialog';
import EditorPopup, { EditorActions } from './EditorPopup';
import { Field, Select, Notice, LoadState, useAction, styles } from './shared';
import { engineKey, request } from './api';
import type { Quiz } from './model';
import { certificateRequest, emptyTemplate, templateInput, type CertificateTemplate, type CertificateTemplateInput, type CertificateTemplates } from './certificateApi';

export default function QuizCertificate({ quiz, editable, onDirty }: { quiz: Quiz; editable: boolean; onDirty: (dirty: boolean) => void }) {
  const { t } = useI18n(), action = useAction(), { confirm, dialogProps } = useConfirm();
  const [enabled, setEnabled] = useState(quiz.has_certificate), [templateDirty, setTemplateDirty] = useState(false);
  const [page, setPage] = useState(1), [limit, setLimit] = useState(20), [search, setSearch] = useState('');
  const [editor, setEditor] = useState<string | null>(null);
  const token = getToken();
  const templates = useQuery({ queryKey: [...engineKey, token, 'certificate-templates', page, limit, search], enabled: !!token,
    queryFn: ({ signal }) => certificateRequest<CertificateTemplates>(`?${new URLSearchParams({ page: String(page), limit: String(limit), sortBy: 'created_at', sortOrder: 'desc', ...(search.trim() ? { name: search.trim() } : {}) })}`, 'GET', undefined, signal), retry: false });
  useEffect(() => { setEnabled(quiz.has_certificate); }, [quiz.has_certificate]);
  useEffect(() => { onDirty(enabled !== quiz.has_certificate || templateDirty); }, [enabled, quiz.has_certificate, templateDirty, onDirty]);
  useEffect(() => { if (templates.data && page > Math.max(1, templates.data.pagination.totalPages)) setPage(Math.max(1, templates.data.pagination.totalPages)); }, [templates.data, page]);
  return <div className={styles.certificateTab}>
    <section className={styles.settingsSection}>
      <h2>{t('quizCertificateTab')}</h2>
      <p className={styles.note}>{t('quizCertificateAvailability')}</p>
      <label className={`quizPopupToggleRow ${styles.check}`}><div><strong>{t('quizHasCertificate')}</strong><span>{t('quizCertificateEnabledHelp')}</span></div><input type="checkbox" checked={enabled} disabled={!editable || action.busy} onChange={event => setEnabled(event.target.checked)} /></label>
      <Notice {...action} />
      {editable && <div className={styles.actions}><button type="button" className={`${styles.button} ${styles.primary}`} disabled={action.busy || enabled === quiz.has_certificate} onClick={() => void action.run(async () => { await request(`/${quiz.id}`, 'PATCH', { has_certificate: enabled }); onDirty(templateDirty); })}>{t(action.busy ? 'saving' : 'saveChanges')}</button></div>}
    </section>
    <section>
      <div className={styles.partHeader}><h2>{t('quizCertificateTemplates')}</h2><button type="button" className={styles.button} disabled={action.busy} onClick={() => setEditor('new')}>{AddSVG}{t('quizCertificateCreate')}</button></div>
      <p className={styles.sectionHelp}>{t('quizCertificateTemplatesHelp')}</p>
      <input className={styles.certificateSearch} type="search" aria-label={t('quizCertificateSearch')} placeholder={t('quizCertificateSearch')} maxLength={255} value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} />
      <LoadState query={templates} />
      {templates.isSuccess && <div className={styles.certificateList}>{templates.data.templates.length ? templates.data.templates.map(template => <article className={styles.partCard} key={template.id}>
        <div className={styles.partCardBody}><div className={styles.partText}><h3>{template.name}</h3>{template.description && <p className={styles.note}>{template.description}</p>}<p className={styles.partMeta}>{template.page_format} · {t(template.orientation === 'portrait' ? 'quizCertificatePortrait' : 'quizCertificateLandscape')}</p></div>
          <div className={styles.partActions}><button type="button" disabled={action.busy} onClick={() => setEditor(template.id)}>{t('adminEdit')}</button><button type="button" className={styles.partRemove} disabled={action.busy} onClick={() => void action.run(async () => {
            if (!await confirm({ title: t('quizCertificateDelete'), message: t('quizCertificateDeleteConfirm', { name: template.name }), yesText: t('adminDelete'), noText: t('adminCancel') })) return false;
            await certificateRequest(`/${encodeURIComponent(template.id)}`, 'DELETE');
          })}>{t('adminDelete')}</button></div>
        </div>
      </article>) : <p className={styles.panel}>{t(search ? 'adminZeroResults' : 'quizCertificateEmpty')}</p>}</div>}
      <Pagination page={page} limit={limit} total={templates.data?.pagination.total} totalPages={templates.data?.pagination.totalPages} loading={templates.isFetching} disabled={action.busy} label={t('quizCertificateTemplates')} onPageChange={setPage} onLimitChange={value => { setLimit(value); setPage(1); }} />
    </section>
    {editor && <TemplateEditor key={editor} id={editor} onClose={() => { setEditor(null); setTemplateDirty(false); }} onDirty={setTemplateDirty} />}
    <ConfirmDialog {...dialogProps} />
  </div>;
}

function TemplateEditor({ id, onClose, onDirty }: { id: string; onClose: () => void; onDirty: (dirty: boolean) => void }) {
  const { t } = useI18n(), { confirm, dialogProps } = useConfirm();
  const [open, setOpen] = useState(true), [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false);
  const detail = useQuery({ queryKey: [...engineKey, getToken(), 'certificate-template', id], enabled: id !== 'new',
    queryFn: ({ signal }) => certificateRequest<{ template: CertificateTemplate }>(`/${encodeURIComponent(id)}`, 'GET', undefined, signal), retry: false });
  const close = async () => {
    if (busy) return;
    if (dirty && !await confirm({ title: t('qeUnsaved'), message: t('qeDiscard'), yesText: t('qeDiscardAction'), noText: t('adminCancel') })) return;
    setOpen(false);
  };
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);
  return <EditorPopup open={open} wide title={t(id === 'new' ? 'quizCertificateCreate' : 'quizCertificateEdit')} onClose={() => void close()} onAfterClose={onClose}>
    {id !== 'new' && !detail.data ? <LoadState query={detail} variant="form" /> : <TemplateForm id={id} initial={detail.data?.template ?? emptyTemplate} onDirty={value => { setDirty(value); onDirty(value); }} onBusy={setBusy} onCancel={() => void close()} onSaved={() => { setDirty(false); onDirty(false); setOpen(false); }} />}
    <ConfirmDialog {...dialogProps} />
  </EditorPopup>;
}

function TemplateForm({ id, initial, onDirty, onBusy, onCancel, onSaved }: { id: string; initial: CertificateTemplateInput; onDirty: (dirty: boolean) => void; onBusy: (busy: boolean) => void; onCancel: () => void; onSaved: () => void }) {
  const { t } = useI18n(), action = useAction();
  const [form, setForm] = useState(() => templateInput(initial)), [baseline] = useState(() => JSON.stringify(templateInput(initial)));
  useEffect(() => { onBusy(action.busy); }, [action.busy, onBusy]);
  const change = (patch: Partial<CertificateTemplateInput>) => { const next = { ...form, ...patch }; setForm(next); onDirty(JSON.stringify(next) !== baseline); };
  const valid = !!form.name.trim() && !!form.html_template.trim();
  return <form className={`quizPopupForm ${styles.settingsForm}`} onSubmit={event => { event.preventDefault(); if (!valid) return; void action.run(async () => {
    await certificateRequest(id === 'new' ? '' : `/${encodeURIComponent(id)}`, id === 'new' ? 'POST' : 'PATCH', form); onSaved();
  }); }}>
    <div className="quizPopupBody"><Notice {...action} /><fieldset disabled={action.busy} className={styles.certificateFields}>
      <Field label={t('quizCertificateName')}><input required maxLength={255} aria-label={t('quizCertificateName')} value={form.name} onChange={event => change({ name: event.target.value })} /></Field>
      <Field label={t('description')}><textarea aria-label={t('description')} value={form.description ?? ''} onChange={event => change({ description: event.target.value || null })} /></Field>
      <div className="quizPopupGrid"><Field label={t('quizCertificateFormat')}><Select label={t('quizCertificateFormat')} value={form.page_format} values={['A4', 'Letter'].map(value => ({ value, label: value }))} onChange={value => change({ page_format: value as CertificateTemplateInput['page_format'] })} /></Field>
        <Field label={t('quizCertificateOrientation')}><Select label={t('quizCertificateOrientation')} value={form.orientation} values={[{ value: 'landscape', label: t('quizCertificateLandscape') }, { value: 'portrait', label: t('quizCertificatePortrait') }]} onChange={value => change({ orientation: value as CertificateTemplateInput['orientation'] })} /></Field></div>
      <p className={styles.note}>{t('quizCertificateContentHelp')}</p>
      <Field label={t('quizCertificateHTML')}><textarea required className={styles.certificateCode} aria-label={t('quizCertificateHTML')} spellCheck={false} rows={10} value={form.html_template} onChange={event => change({ html_template: event.target.value })} /></Field>
      <Field label={t('quizCertificateCSS')}><textarea className={styles.certificateCode} aria-label={t('quizCertificateCSS')} spellCheck={false} rows={8} value={form.css_template} onChange={event => change({ css_template: event.target.value })} /></Field>
    </fieldset></div>
    <EditorActions><button type="button" className="cancelBtn" disabled={action.busy} onClick={onCancel}>{t('adminCancel')}</button><button type="submit" className="saveCaptionsBtn" disabled={action.busy || !valid || (id !== 'new' && JSON.stringify(form) === baseline)}>{t(action.busy ? 'saving' : 'adminSave')}</button></EditorActions>
  </form>;
}
