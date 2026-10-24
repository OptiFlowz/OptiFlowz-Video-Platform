import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '~/i18n';
import { getToken } from '~/functions';
import { AddSVG, SearchSVG, CopySVG, CheckSVG, DeleteSVG } from '~/constants';
import Pagination from '~/components/library/pagination';
import { ConfirmDialog } from '~/components/confirmPopup/confirmDialog';
import { useConfirm } from '~/components/confirmPopup/useConfirm';
import { engineKey } from './api';
import { Field, Select, Notice, LoadState, useAction, styles } from './shared';
import { allCertificateTemplates, certificateRequest, emptyTemplate, previewCertificate, templateInput, type CertificateTemplate, type CertificateTemplateInput } from './certificateApi';

import CodeEditor from '../cssColorEditor/CssColorEditor';
import { certificateHtmlDocument, certificatePaper } from './certificatePreview';

type Props = { id: string | null; onEdit: (id?: string) => void; onSaved: (id: string) => void; onDirty: (dirty: boolean) => void; onBusy: (busy: boolean) => void };
const placeholders = ['user.full_name', 'quiz.title', 'result.score_percentage', 'result.earned_points', 'result.max_points', 'certificate.number', 'certificate.issued_at'];

export default function CertificateTemplates(props: Props) {
  const { t } = useI18n(), token = getToken();
  const action = useAction(), { confirm, dialogProps } = useConfirm();
  const [search, setSearch] = useState(''), [page, setPage] = useState(1), [limit, setLimit] = useState(20);
  const templates = useQuery({ queryKey: [...engineKey, token, 'certificate-templates'], enabled: !!token && !props.id,
    queryFn: ({ signal }) => allCertificateTemplates(signal), retry: false });
  const rows = (templates.data ?? []).filter(row => row.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const totalPages = Math.max(1, Math.ceil(rows.length / limit));
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);
  const remove = (template: CertificateTemplate) => {
    if (template.is_system || action.busy) return;
    void action.run(async () => {
      if (!await confirm({ intent: 'danger', title: t('quizCertificateDelete'), message: t('quizCertificateDeleteConfirm', { name: template.name }), yesText: t('adminDelete'), noText: t('adminCancel') })) return false;
      await certificateRequest(`/${encodeURIComponent(template.id)}`, 'DELETE');
    });
  };
  if (props.id) return <TemplateDetail key={props.id} {...props} id={props.id} />;
  return <section className={styles.certificateTab}>
    <div className={styles.toolbar}>
      <div className={styles.certificateFilter}>{SearchSVG}<input type="search" aria-label={t('quizCertificateSearch')} placeholder={t('quizCertificateSearch')} maxLength={255} value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /></div>
      <button type="button" className={styles.button} disabled={action.busy} onClick={() => props.onEdit('new')}>{AddSVG}{t('quizCertificateCreate')}</button>
    </div>
    <Notice {...action} />
    <LoadState query={templates} />
    {templates.isSuccess && <div className={styles.certificateGallery}>
      {rows.slice((page - 1) * limit, page * limit).map(template => <article className={styles.certificateCard} key={template.id}>
        <button type="button" className={styles.certificateCardOpen} aria-label={`${t('adminEdit')}: ${template.name}`} disabled={action.busy} onClick={() => props.onEdit(template.id)}><span className="sr-only">{t('adminEdit')}</span></button>
        <div className={styles.certificateThumbnail} aria-hidden="true" inert><CertificateHtmlPreview template={template} thumbnail /></div>
        <div className={styles.certificateCardBody}>
          <div className={styles.certificateCardTop}><h2>{template.name}</h2>{template.is_system && <span className={styles.badge}>{t(template.is_default ? 'quizCertificateDefault' : 'quizCertificateSystem')}</span>}</div>
          {template.description && <p>{template.description}</p>}
          <div className={styles.certificateCardBottom}><span>{template.page_format} · {t(template.orientation === 'portrait' ? 'quizCertificatePortrait' : 'quizCertificateLandscape')}</span>{!template.is_system && <span className="managementRowActions"><button type="button" className={`danger ${styles.certificateCardDelete}`} aria-label={`${t('adminDelete')}: ${template.name}`} title={t('adminDelete')} disabled={action.busy} onClick={() => remove(template)}>{DeleteSVG}</button></span>}</div>
        </div>
      </article>)}
      {!rows.length && <p className={styles.panel}>{t(search ? 'adminZeroResults' : 'quizCertificateEmpty')}</p>}
    </div>}
    <Pagination page={page} limit={limit} total={rows.length} totalPages={totalPages} loading={templates.isFetching} disabled={action.busy} label={t('quizCertificateLibrary')} onPageChange={setPage} onLimitChange={value => { setLimit(value); setPage(1); }} />
    <ConfirmDialog {...dialogProps} />
  </section>;
}

function TemplateDetail(props: Props & { id: string }) {
  const detail = useQuery({ queryKey: [...engineKey, getToken(), 'certificate-template', props.id], enabled: props.id !== 'new',
    queryFn: ({ signal }) => certificateRequest<{ template: CertificateTemplate }>(`/${encodeURIComponent(props.id)}`, 'GET', undefined, signal), retry: false });
  if (props.id !== 'new' && !detail.data) return <LoadState query={detail} variant="form" />;
  return <TemplateForm {...props} initial={detail.data?.template ?? emptyTemplate} />;
}

export function TemplateForm({ id, initial, onEdit, onSaved, onDirty, onBusy }: Props & { id: string; initial: CertificateTemplateInput | CertificateTemplate }) {
  const { t } = useI18n(), action = useAction(), { confirm, dialogProps } = useConfirm();
  const [form, setForm] = useState(() => templateInput(initial)), [baseline, setBaseline] = useState(() => JSON.stringify(templateInput(initial)));
  const [revision, setRevision] = useState(0);
  const [copiedField, setCopiedField] = useState('');
  useEffect(() => {
    if (!copiedField) return;
    const timer = window.setTimeout(() => setCopiedField(''), 2000);
    return () => window.clearTimeout(timer);
  }, [copiedField]);
  const copyField = async (value: string) => {
    try {
      await navigator.clipboard.writeText(`{{${value}}}`);
      setCopiedField(value);
    } catch { action.setError(t('quizError')); }
  };
  const readOnly = 'is_system' in initial && initial.is_system;
  const dirty = JSON.stringify(templateInput(form)) !== baseline;
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => { onBusy(action.busy); return () => onBusy(false); }, [action.busy, onBusy]);
  const change = (patch: Partial<CertificateTemplateInput>) => setForm(current => ({ ...current, ...patch }));
  const valid = !!form.name.trim() && !!form.html_template.trim();
  const save = async () => {
    const result = await certificateRequest<{ template: CertificateTemplate }>(id === 'new' ? '' : `/${encodeURIComponent(id)}`, id === 'new' ? 'POST' : 'PATCH', form);
    setBaseline(JSON.stringify(templateInput(form))); onDirty(false);
    if (id === 'new') onSaved(result.template.id); else setRevision(value => value + 1);
  };
  return <div className={styles.certificateTab}>
    <div className={styles.toolbar}>
      <div className="libraryHeading"><h1>{id === 'new' ? t('quizCertificateCreate') : form.name}</h1></div>
      <div className={styles.actions}>
        {id !== 'new' && <button type="button" className={styles.button} disabled={action.busy || dirty} onClick={() => void action.run(async () => {
          const result = await certificateRequest<{ template: CertificateTemplate }>('', 'POST', { ...templateInput(form), name: `${form.name.slice(0, 248)} - copy` });
          onSaved(result.template.id);
        })}>{t('quizCertificateCopy')}</button>}
        {id !== 'new' && !readOnly && <button type="button" className={`${styles.button} ${styles.danger}`} disabled={action.busy} onClick={() => void action.run(async () => {
          if (!await confirm({ title: t('quizCertificateDelete'), message: t('quizCertificateDeleteConfirm', { name: initial.name }), yesText: t('adminDelete'), noText: t('adminCancel') })) return false;
          await certificateRequest(`/${encodeURIComponent(id)}`, 'DELETE'); onDirty(false); onSaved('');
        })}>{t('adminDelete')}</button>}
      </div>
    </div>
    {readOnly && <p className={styles.sectionHelp}>{t('quizCertificateReadOnly')}</p>}
    <div className={styles.certificateWorkspace}>
      <form className={`quizPopupForm ${styles.settingsForm} ${styles.certificateForm}`} onSubmit={event => { event.preventDefault(); if (valid && !readOnly && !action.busy) void action.run(save); }}>
        <Notice {...action} />
        <fieldset disabled={action.busy || readOnly} className={styles.certificateFields}>
          <Field label={t('quizCertificateName')}><input required maxLength={255} aria-label={t('quizCertificateName')} value={form.name} onChange={event => change({ name: event.target.value })} /></Field>
          <Field label={t('description')}><textarea aria-label={t('description')} rows={3} value={form.description ?? ''} onChange={event => change({ description: event.target.value || null })} /></Field>
          <div className="quizPopupGrid">
            <Field label={t('quizCertificateFormat')}><Select disabled={readOnly || action.busy} label={t('quizCertificateFormat')} value={form.page_format} values={['A4', 'Letter'].map(value => ({ value, label: value }))} onChange={value => change({ page_format: value as CertificateTemplateInput['page_format'] })} /></Field>
            <Field label={t('quizCertificateOrientation')}><Select disabled={readOnly || action.busy} label={t('quizCertificateOrientation')} value={form.orientation} values={[{ value: 'landscape', label: t('quizCertificateLandscape') }, { value: 'portrait', label: t('quizCertificatePortrait') }]} onChange={value => change({ orientation: value as CertificateTemplateInput['orientation'] })} /></Field>
          </div>
          <Field label={t('quizCertificateHTML')}><CodeEditor language="html" label={t('quizCertificateHTML')} disabled={readOnly || action.busy} value={form.html_template} onChange={html_template => change({ html_template })} /></Field>
          <Field label={t('quizCertificateCSS')}><CodeEditor label={t('quizCertificateCSS')} disabled={readOnly || action.busy} value={form.css_template} onChange={css_template => change({ css_template })} /></Field>
        </fieldset>
        <details className={styles.certificatePlaceholderHelp}><summary>{t('quizCertificatePlaceholders')}</summary><ul>{placeholders.map(value => <li key={value}><code>{`{{${value}}}`}</code><button type="button" className={styles.certificateFieldCopy} title={t(copiedField === value ? 'liveCopied' : 'copy')} aria-label={`${t(copiedField === value ? 'liveCopied' : 'copy')}: {{${value}}}`} onClick={() => void copyField(value)}>{copiedField === value ? CheckSVG : CopySVG}</button></li>)}</ul></details>
        {!readOnly && <div className={styles.actions}><button type="submit" className={`${styles.button} ${styles.primary}`} disabled={action.busy || !valid || (id !== 'new' && !dirty)}>{t(action.busy ? 'saving' : 'saveChanges')}</button></div>}
      </form>
      <CertificatePreview id={id} revision={revision} dirty={dirty} template={form} savedTemplate={JSON.parse(baseline)} />
    </div>
    <ConfirmDialog {...dialogProps} />
  </div>;
}

export function CertificatePreview({ id, revision, dirty, template, savedTemplate }: { id: string; revision: number; dirty: boolean; template: CertificateTemplateInput; savedTemplate: CertificateTemplateInput }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<'html' | 'pdf'>('html'), [pdfRequested, setPdfRequested] = useState(false);
  return <aside className={styles.certificatePreview} aria-label={t('postPreview')}>
    <h2>{t('postPreview')}</h2>
    <div className={styles.certificatePreviewTabs} role="tablist" aria-label={t('postPreview')}>
      {(['html', 'pdf'] as const).map(value => <button key={value} type="button" role="tab" aria-selected={mode === value} onClick={() => { setMode(value); if (value === 'pdf') setPdfRequested(true); }} onKeyDown={event => {
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
          event.preventDefault(); const next = event.key === 'Home' ? 'html' : event.key === 'End' ? 'pdf' : value === 'html' ? 'pdf' : 'html';
          setMode(next); if (next === 'pdf') setPdfRequested(true);
          (event.currentTarget.parentElement?.children[next === 'html' ? 0 : 1] as HTMLButtonElement)?.focus();
        }
      }} tabIndex={mode === value ? 0 : -1}>{value.toUpperCase()} {t('postPreview')}</button>)}
    </div>
    {(dirty || id === 'new') && <p className={styles.certificatePreviewHint}>PDF: {t('quizCertificateSavePreview')}</p>}
    <div hidden={mode !== 'html'} role="tabpanel" aria-label={`HTML ${t('postPreview')}`}><CertificateHtmlPreview template={template} /></div>
    {pdfRequested && <div hidden={mode !== 'pdf'} role="tabpanel" aria-label={`PDF ${t('postPreview')}`}><CertificatePdfPreview id={id} revision={revision} template={savedTemplate} /></div>}
  </aside>;
}

function CertificateHtmlPreview({ template, thumbnail = false }: { template: CertificateTemplateInput; thumbnail?: boolean }) {
  const { t } = useI18n();
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const paper = certificatePaper(template);
  const document = useMemo(() => certificateHtmlDocument(template), [template.html_template, template.css_template, template.page_format, template.orientation]);
  useEffect(() => {
    const element = container.current; if (!element) return;
    const update = () => setWidth(element.clientWidth);
    update(); const observer = new ResizeObserver(update); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <div ref={container} className={styles.certificatePaper} style={{ aspectRatio: `${paper.width} / ${paper.height}`, ...(thumbnail ? { width: `${Math.max(1, paper.width / paper.height) * 100}%` } : {}) }}>
    <iframe loading={thumbnail ? "lazy" : "eager"} tabIndex={thumbnail ? -1 : undefined} title={`HTML ${t('postPreview')}`} sandbox="" referrerPolicy="no-referrer" srcDoc={document} style={{ width: paper.width, height: paper.height, transform: `scale(${width / paper.width})` }} />
  </div>;
}

function CertificatePdfPreview({ id, revision, template }: { id: string; revision: number; template: CertificateTemplateInput }) {
  const { t } = useI18n();
  const [url, setUrl] = useState(''), [error, setError] = useState(''), [loading, setLoading] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    setUrl(''); setError('');
    if (id === 'new') { setLoading(false); return; }
    const controller = new AbortController(); let objectUrl = '';
    setLoading(true);
    void previewCertificate(id, controller.signal).then(blob => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t('quizError')); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
    // Language changes must not consume a new server render / rate-limit slot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, revision, retry]);
  const paper = certificatePaper(template);
  return <>
    {loading && <p role="status">{t('quizLoadingQuiz')}</p>}
    {error && <div role="alert"><p className={styles.error}>{error}</p><button type="button" className={styles.button} onClick={() => setRetry(value => value + 1)}>{t('usersRetry')}</button></div>}
    {url && <><iframe className={styles.certificatePdf} style={{ aspectRatio: `${paper.width} / ${paper.height}` }} title={`PDF ${t('postPreview')}`} src={`${url}#toolbar=0&navpanes=0&view=Fit`} /><a className={styles.button} href={url} target="_blank" rel="noopener noreferrer">{t('adminOpen')}</a></>}
  </>;
}
