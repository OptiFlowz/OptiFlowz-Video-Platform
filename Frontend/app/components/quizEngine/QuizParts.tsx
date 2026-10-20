import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '~/i18n';
import { AddSVG } from '~/constants';
import PlaylistVideoPicker from '~/components/editPlaylistPage/PlaylistVideoPicker';
import { ConfirmDialog } from '~/components/confirmPopup/confirmDialog';
import { useConfirm } from '~/components/confirmPopup/useConfirm';
import { request } from './api';
import { Field, Select, Notice, LoadState, useAction, useAccess, useAll, styles } from './shared';
import EditorPopup from './EditorPopup';
import { typeLabels, type Quiz, type Candidate, type Question, type Group, type Source, type Requirement, type VideoCard } from './model';
import { allocationValid, sourceQuotas } from './readiness';
import { numberDraftValue, type NumberDraft } from './numberDraft';
import CandidateList from './CandidateList';

type PartProps = { quiz: Quiz; editable: boolean; onBack: () => void };
const scrollClass = `quizPopupScroll ${styles.popupScroll} ${styles.partBody}`;
function Footer({ onBack, busy = false, children }: { onBack: () => void; busy?: boolean; children?: ReactNode }) {
  const { t } = useI18n();
  return <div className={`quizPopupActions ${styles.partFooter}`}><button type="button" className="cancelBtn" disabled={busy} onClick={onBack}>{t('back')}</button>{children}</div>;
}
function AddButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button type="button" className={styles.partAdd} disabled={disabled} onClick={onClick}>{AddSVG}{children}</button>;
}
function PartCard({ title, meta, children, image, video = false, editable, busy, onEdit, onRemove }: {
  title: string; meta: ReactNode; children?: ReactNode; image?: string | null; video?: boolean; editable: boolean; busy: boolean; onEdit: () => void; onRemove: () => void;
}) {
  const { t } = useI18n();
  return <article className={styles.partCard}>
    <div className={styles.partMeta}>{meta}</div>
    <div className={styles.partCardBody}><div className={styles.partIdentity}>
      {video && (image ? <img src={image} alt="" className={styles.partThumbnail} /> : <div className={styles.partThumbnail}>{t('quizNoThumbnail')}</div>)}
      <div className={styles.partText}><p>{title}</p>{children}</div>
    </div>{editable && <div className={styles.partActions}>
      <button type="button" disabled={busy} onClick={onEdit}>{t('adminEdit')}</button>
      <button type="button" className={styles.partRemove} disabled={busy} onClick={onRemove}>{t('quizRemove')}</button>
    </div>}</div>
  </article>;
}
/** Keep editing separate from the summary cards, as in the original quiz popups. */
function DraftDialog<T extends object>({ title, initial, onClose, save, children, valid = () => true }: {
  title: string; initial: T; onClose: () => void; save: (draft: T) => Promise<void>; children: (draft: T, update: (patch: Partial<T>) => void) => ReactNode; valid?: (draft: T) => boolean;
}) {
  const { t } = useI18n(), action = useAction();
  const [draft, setDraft] = useState(initial), { confirm, dialogProps } = useConfirm();
  const dirty = JSON.stringify(initial) !== JSON.stringify(draft);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);
  const close = async () => {
    if (action.busy) return;
    if (dirty && !await confirm({ title: t('qeUnsaved'), message: t('qeDiscard'), yesText: t('qeDiscardAction'), noText: t('adminCancel') })) return;
    onClose();
  };
  return <EditorPopup open compact title={title} onClose={() => void close()}>
    <form className={`quizPopupForm ${styles.settingsForm}`} onSubmit={event => { event.preventDefault(); event.stopPropagation(); if (!valid(draft)) return; let saved = false; void action.run(async () => { await save(draft); saved = true; }).then(() => { if (saved) onClose(); }); }}>
      <div className="quizPopupBody"><Notice {...action} /><fieldset disabled={action.busy}>{children(draft, patch => setDraft(previous => ({ ...previous, ...patch })))}</fieldset></div>
      <div className="quizPopupActions"><button type="button" className="cancelBtn" disabled={action.busy} onClick={() => void close()}>{t('adminCancel')}</button><button type="submit" className="saveCaptionsBtn" disabled={action.busy || !valid(draft)}>{t(action.busy ? 'saving' : 'adminSave')}</button></div>
    </form><ConfirmDialog {...dialogProps} />
  </EditorPopup>;
}
function Position({ value, change }: { value: number | ''; change: (value: number | '') => void }) {
  const { t } = useI18n();
  return <Field label={t('qePosition')}><input aria-label={t('qePosition')} required type="number" min={0} max={2147483647} value={value} onChange={e => change(numberDraftValue(e.target.value))} /></Field>;
}

export function Candidates({ quiz, editable, onBack, onDirty = () => {} }: PartProps & { onDirty?: (dirty: boolean) => void }) {
  const { t } = useI18n(), bankAccess = useAccess('questions');
  const linked = useAll<Candidate>(`/${quiz.id}/questions`, 'questions');
  const bank = useAll<Question>('/questions', 'questions', bankAccess.read);
  const [adding, setAdding] = useState(false), [filter, setFilter] = useState('');
  const [order, setOrder] = useState<Candidate[] | null>(null);
  const mutation = useRef(false), dirtyPoints = useRef(new Set<string>());
  const action = useAction(), { confirm, dialogProps } = useConfirm();
  const included = new Set(linked.data?.map(q => q.question_id));
  const rows = order ?? [...(linked.data ?? [])].sort((a, b) => a.position - b.position || a.question_id.localeCompare(b.question_id));
  const reportDirty = (id: string, dirty: boolean) => { if (dirty) dirtyPoints.current.add(id); else dirtyPoints.current.delete(id); onDirty(dirtyPoints.current.size > 0); };
  const mutate = async (work: () => Promise<void | boolean>) => {
    if (mutation.current || !editable) return false;
    mutation.current = true;
    let saved = false;
    try { await action.run(async () => { const result = await work(); saved = result !== false; return result; }); return saved; }
    finally { mutation.current = false; }
  };
  const move = async (id: string, targetId: string) => {
    if (mutation.current || action.busy || !editable) return;
    const from = rows.findIndex(row => row.question_id === id), to = rows.findIndex(row => row.question_id === targetId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...rows], [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setOrder(next.map((row, position) => ({ ...row, position })));
    try { await mutate(async () => { await request(`/${quiz.id}/questions/${id}`, 'PATCH', { position: to }); }); }
    finally { setOrder(null); }
  };
  const remove = (row: Candidate) => void mutate(async () => {
    if (!await confirm({ title: t('quizRemove'), message: t('qeUnlinkQuestion'), yesText: t('quizRemove'), noText: t('adminCancel') })) return false;
    await request(`/${quiz.id}/questions/${row.question_id}`, 'DELETE');
    reportDirty(row.question_id, false);
  });
  return <>
    <div className={scrollClass}><h4 className={styles.partHeading}>{t('qeCandidates')} {linked.data && <span>{linked.data.length}</span>}</h4><Notice {...action} /><LoadState query={linked} />
      <CandidateList rows={rows} editable={editable} busy={action.busy} onMove={(id, targetId) => { void move(id, targetId); }} onDirty={reportDirty} onRemove={remove}
        onPoints={(row, max_points) => mutate(async () => { await request(`/${quiz.id}/questions/${row.question_id}`, 'PATCH', { max_points }); })} />
      {!linked.data?.length && linked.isSuccess && <p className={styles.partEmpty}>{t('quizNoQuestionsYet')}</p>}
      {editable && bankAccess.read && <AddButton disabled={action.busy || !linked.isSuccess} onClick={() => setAdding(true)}>{t('quizAddQuestion')}</AddButton>}
    </div><Footer onBack={onBack} busy={action.busy} />
    <EditorPopup open={adding} title={t('quizAddQuestion')} description={t('qeCandidatesHelp')} onClose={() => { if (!action.busy) setAdding(false); }} wide>
      <div className={scrollClass}><Notice {...action} /><LoadState query={bank} /><input className={styles.partFilter} type="search" placeholder={t('qeFilterQuestions')} aria-label={t('qeFilterQuestions')} value={filter} onChange={e => setFilter(e.target.value)} />
        {bank.data?.filter(q => q.user_id === quiz.user_id && q.content.toLowerCase().includes(filter.toLowerCase())).map(q => <div className={`${styles.partCard} ${included.has(q.id) ? styles.usedQuestion : ''}`} key={q.id}><div className={styles.partCardBody}><div className={styles.partText}><p>{q.content || t('qeUntitledQuestion')}</p><small>{t(typeLabels[q.type])} · {q.groups.map(g => g.name).join(', ')}</small></div><button type="button" className={styles.icon} aria-label={`${t('quizAddQuestion')}: ${q.content}`} disabled={action.busy || !linked.isSuccess || included.has(q.id)} onClick={() => void action.run(async () => { await request(`/${quiz.id}/questions`, 'POST', { question_id: q.id, position: Math.max(-1, ...linked.data!.map(item => item.position)) + 1, max_points: 1 }); })}>{AddSVG}</button></div></div>)}
      </div><Footer busy={action.busy} onBack={() => setAdding(false)} />
    </EditorPopup>
    <ConfirmDialog {...dialogProps} />
  </>;
}

export function Sources({ quiz, editable, onDirty, onBack }: PartProps & { onDirty: (value: boolean) => void }) {
  const sources = useAll<Source>(`/${quiz.id}/sources`, 'sources');
  if (!sources.data) return <><div className={scrollClass}><LoadState query={sources} /></div><Footer onBack={onBack} /></>;
  return <SourceForm quiz={quiz} initial={sources.data} editable={editable} onDirty={onDirty} onBack={onBack} />;
}
function SourceForm({ quiz, initial, editable, onDirty, onBack }: PartProps & { initial: Source[]; onDirty: (value: boolean) => void }) {
  const { t } = useI18n(), groupAccess = useAccess('groups');
  const groups = useAll<Group>('/question-groups', 'groups', groupAccess.read);
  const [rows, setRows] = useState<Source[]>(initial), [mode, setMode] = useState(initial[0]?.question_count != null ? 'count' : 'percentage');
  const [baseline, setBaseline] = useState(JSON.stringify(initial)), [editing, setEditing] = useState<{ index: number; row: Source } | null>(null);
  const action = useAction(), { confirm, dialogProps } = useConfirm();
  const update = (next: Source[]) => { setRows(next); onDirty(JSON.stringify(next) !== baseline); };
  const choices = [...new Map([...(initial.flatMap(s => s.group ? [{ ...s.group, user_id: quiz.user_id }] : [])), ...(groups.data ?? [])].map(g => [g.id, g])).values()].filter(g => g.user_id === quiz.user_id);
  const valid = allocationValid(rows, quiz.question_count), quotas = valid ? sourceQuotas(rows, quiz.question_count) : [];
  return <>
    <div className={scrollClass}><h4 className={styles.partHeading}>{t('quizSourcesButton')} <span>{rows.length}</span></h4><Notice {...action} />
      <Field label={t('qeAllocationMode')} hint={t('qeAllocationModeHelp')}><Select label={t('qeAllocationMode')} disabled={action.busy || !editable} value={mode} values={[{ value: 'percentage', label: t('quizPercentage') }, { value: 'count', label: t('quizFixedQuestionCount') }]} onChange={value => { setMode(value); update(rows.map(row => ({ ...row, question_percentage: value === 'percentage' ? 1 : null, question_count: value === 'count' ? 1 : null }))); }} /></Field>
      {groupAccess.read && <LoadState query={groups} variant="inline" />}
      {rows.map((row, index) => <PartCard key={`${index}:${row.group_id}`} title={choices.find(g => g.id === row.group_id)?.name || row.group?.name || row.group_id} meta={<>{mode === 'percentage' ? `${row.question_percentage}%` : t('quizFixedQuestionsCount', { count: row.question_count ?? 0 })}{valid && <> · {t('quizQuestionsCount', { count: quotas[index] })}</>}</>} editable={editable} busy={action.busy} onEdit={() => setEditing({ index, row })} onRemove={() => void (async () => {
        if (await confirm({ title: t('quizRemove'), message: t('quizDeleteSourceMessage'), yesText: t('quizRemove'), noText: t('adminCancel') })) update(rows.filter((_, i) => i !== index));
      })()}><small>{t('qePosition')}: {row.position}</small></PartCard>)}
      {!rows.length && <p className={styles.partEmpty}>{t('quizNoSourcesYet')}</p>}
      {editable && <AddButton disabled={action.busy || !groups.isSuccess || rows.length >= 1000} onClick={() => setEditing({ index: rows.length, row: { group_id: '', position: Math.max(-1, ...rows.map(row => row.position)) + 1, question_percentage: mode === 'percentage' ? 1 : null, question_count: mode === 'count' ? 1 : null } })}>{t('quizAddSource')}</AddButton>}
      <p className={styles.partMeta}>{t('qeAllocationTotal', { total: rows.reduce((sum, s) => sum + Number(mode === 'percentage' ? s.question_percentage : s.question_count), 0), required: mode === 'percentage' ? 100 : quiz.question_count })}</p>
      {!valid && <p className={styles.error}>{t('qeAllocationInvalid')}</p>}
    </div><Footer onBack={onBack} busy={action.busy}>{editable && <button type="button" className="saveCaptionsBtn" disabled={action.busy || !valid || JSON.stringify(rows) === baseline} onClick={() => void action.run(async () => {
      await request(`/${quiz.id}/sources`, 'PUT', { sources: rows.map(({ group_id, position, question_percentage, question_count }) => ({ group_id, position, question_percentage, question_count })) });
      setBaseline(JSON.stringify(rows)); onDirty(false);
    })}>{t(action.busy ? 'saving' : 'saveChanges')}</button>}</Footer>
    {editing && <DraftDialog<NumberDraft<Source>> title={t(editing.index < rows.length ? 'quizEditSource' : 'quizAddSource')} initial={editing.row} onClose={() => setEditing(null)} valid={draft => !!draft.group_id} save={async draft => {
      const next = [...rows]; next[editing.index] = { ...draft, position: Number(draft.position), question_percentage: draft.question_percentage === null ? null : Number(draft.question_percentage), question_count: draft.question_count === null ? null : Number(draft.question_count), group: choices.find(g => g.id === draft.group_id) }; update(next);
    }}>{(draft, change) => <>
      <Field label={t('qeGroup')}><Select label={t('qeGroup')} value={draft.group_id} values={[{ value: '', label: t('quizSelect') }, ...choices.map(g => ({ value: g.id, label: g.name, disabled: rows.some((s, i) => i !== editing.index && s.group_id === g.id) }))]} onChange={group_id => change({ group_id })} /></Field>
      <div className="quizPopupGrid"><Field label={t(mode === 'percentage' ? 'quizPercentage' : 'quizQuestionCount')}><input aria-label={t(mode === 'percentage' ? 'quizPercentage' : 'quizQuestionCount')} type="number" required min={mode === 'percentage' ? 0.01 : 1} max={mode === 'percentage' ? 100 : 2147483647} step={mode === 'percentage' ? 0.01 : 1} value={mode === 'percentage' ? draft.question_percentage ?? '' : draft.question_count ?? ''} onChange={e => change({ [mode === 'percentage' ? 'question_percentage' : 'question_count']: numberDraftValue(e.target.value) })} /></Field><Position value={draft.position} change={position => change({ position })} /></div>
    </>}</DraftDialog>}<ConfirmDialog {...dialogProps} />
  </>;
}

export function Requirements({ quiz, editable, onBack }: PartProps) {
  const { t } = useI18n(), action = useAction(), { confirm, dialogProps } = useConfirm();
  const query = useAll<Requirement>(`/quiz-requirements?quiz_id=${quiz.id}`, 'requirements');
  const [adding, setAdding] = useState(false), [editing, setEditing] = useState<{ row: Requirement; isNew: boolean } | null>(null);
  const selectVideo = (video: VideoCard) => setEditing({ isNew: true, row: { quiz_id: quiz.id, video_id: video.id, video_card: video, position: Math.max(-1, ...(query.data ?? []).map(r => r.position)) + 1, min_watch_percentage: 100, min_watch_seconds: null } });
  return <>
    <div className={scrollClass}><h4 className={styles.partHeading}>{t('quizRulesButton')} {query.data && <span>{query.data.length}</span>}</h4><Notice {...action} /><LoadState query={query} />
      {query.data?.map(row => <PartCard key={row.video_id} video image={row.video_card?.thumbnail_url || row.video_card?.mux_thumbnail_url} title={row.min_watch_percentage !== null ? t('quizWatchPercentageSummary', { percentage: row.min_watch_percentage, video: row.video_card?.title || t('quizRequiredVideo') }) : t('quizWatchSecondsSummary', { seconds: row.min_watch_seconds ?? 0, video: row.video_card?.title || t('quizRequiredVideo') })} meta={t(row.min_watch_percentage !== null ? 'quizVideoWatchPercentage' : 'quizVideoWatchSeconds')} editable={editable} busy={action.busy} onEdit={() => setEditing({ row, isNew: false })} onRemove={() => void action.run(async () => {
        if (!await confirm({ title: t('quizRemove'), message: t('quizDeleteRuleMessage'), yesText: t('quizRemove'), noText: t('adminCancel') })) return false;
        await request(`/quiz-requirements/${quiz.id}/${row.video_id}`, 'DELETE');
      })}><small>{row.video_card?.title || row.video_id}</small></PartCard>)}
      {query.isSuccess && !query.data?.length && <p className={styles.partEmpty}>{t('quizNoRulesYet')}</p>}
      {editable && <AddButton disabled={action.busy || !query.isSuccess} onClick={() => setAdding(true)}>{t('quizAddRule')}</AddButton>}
    </div><Footer onBack={onBack} busy={action.busy} />
    <EditorPopup open={adding} title={t('quizAddRule')} description={t('quizSelectVideoForRule')} onClose={() => setAdding(false)} wide>
      <div className={scrollClass}><PlaylistVideoPicker ownerId={quiz.user_id} included={query.data?.map(r => r.video_id) ?? []} busy={!query.isSuccess} addingId={null} onAdd={selectVideo} /></div><Footer onBack={() => setAdding(false)} />
    </EditorPopup>
    {editing && <DraftDialog<NumberDraft<{ mode: string; value: number }>> title={t(editing.isNew ? 'quizAddRule' : 'quizEditRule')} initial={{ mode: editing.row.min_watch_percentage !== null ? 'percentage' : 'seconds', value: Number(editing.row.min_watch_percentage ?? editing.row.min_watch_seconds) }} onClose={() => setEditing(null)} save={async draft => {
      const patch = { min_watch_percentage: draft.mode === 'percentage' ? Number(draft.value) : null, min_watch_seconds: draft.mode === 'seconds' ? Number(draft.value) : null };
      await request(editing.isNew ? '/quiz-requirements' : `/quiz-requirements/${quiz.id}/${editing.row.video_id}`, editing.isNew ? 'POST' : 'PATCH', editing.isNew ? { quiz_id: quiz.id, video_id: editing.row.video_id, position: editing.row.position, ...patch } : patch);
    }}>{(draft, change) => <>
      <p className={styles.draftTitle}>{editing.row.video_card?.title || t('quizRequiredVideo')}</p>
      <Field label={t('quizRuleType')}><Select label={t('quizRuleType')} value={draft.mode} values={[{ value: 'percentage', label: t('quizVideoWatchPercentage') }, { value: 'seconds', label: t('quizVideoWatchSeconds') }]} onChange={mode => change({ mode, value: mode === 'percentage' ? 100 : 1 })} /></Field>
      <Field label={t(draft.mode === 'percentage' ? 'quizRequiredPercentage' : 'quizRequiredSeconds')}><input aria-label={t(draft.mode === 'percentage' ? 'quizRequiredPercentage' : 'quizRequiredSeconds')} required type="number" min={draft.mode === 'percentage' ? 0.01 : 1} max={draft.mode === 'percentage' ? 100 : editing.row.video_card?.duration_seconds || 2147483647} step={draft.mode === 'percentage' ? 0.01 : 1} value={draft.value} onChange={e => change({ value: numberDraftValue(e.target.value) })} /></Field>
    </>}</DraftDialog>}<ConfirmDialog {...dialogProps} />
  </>;
}
