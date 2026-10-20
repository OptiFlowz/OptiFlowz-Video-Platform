import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '~/i18n';
import { AddSVG } from '~/constants';
import PlaylistVideoPicker from '~/components/editPlaylistPage/PlaylistVideoPicker';
import { ConfirmDialog } from '~/components/confirmPopup/confirmDialog';
import { useConfirm } from '~/components/confirmPopup/useConfirm';
import { request } from './api';
import { Field, Select, Notice, LoadState, useAction, useAccess, useAll, styles } from './shared';
import EditorPopup from './EditorPopup';
import { typeLabels, type Quiz, type Candidate, type Question, type Category, type Source, type Requirement, type VideoCard } from './model';
import { allocationValid, nextPosition, questionCount } from './readiness';
import { numberDraftValue, type NumberDraft } from './numberDraft';
import CandidateList from './CandidateList';
import { saveRequirement } from './saveRequirement';

type PartProps = { quiz: Quiz; editable: boolean; onBack?: () => void };
const scrollClass = `quizPopupScroll ${styles.popupScroll} ${styles.partBody}`;
function Footer({ onBack, busy = false, children }: { onBack?: () => void; busy?: boolean; children?: ReactNode }) {
  const { t } = useI18n();
  if (!onBack && !children) return null;
  return <div className={`quizPopupActions ${styles.partFooter}`}>{onBack && <button type="button" className="cancelBtn" disabled={busy} onClick={onBack}>{t('back')}</button>}{children}</div>;
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
function DraftDialog<T extends object>({ title, initial, onClose, save, children, valid = () => true, className }: {
  title: string; initial: T; onClose: () => void; save: (draft: T) => Promise<void>; children: (draft: T, update: (patch: Partial<T>) => void) => ReactNode; valid?: (draft: T) => boolean; className?: string;
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
  return <EditorPopup open compact title={title} onClose={() => void close()} className={className}>
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
  const sources = useAll<Source>(`/${quiz.id}/sources`, 'sources');
  const bank = useAll<Question>('/questions', 'questions', bankAccess.read);
  const [adding, setAdding] = useState(false), [filter, setFilter] = useState(''), [categoryFilter, setCategoryFilter] = useState('');
  const bankCategories = [...new Map((bank.data ?? []).filter(q => q.user_id === quiz.user_id && q.category).map(q => [q.category!.id, q.category!])).values()];
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
    setOrder(next);
    try { await mutate(async () => { await request(`/${quiz.id}/questions/${id}`, 'PATCH', { position: rows[to].position }); }); }
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
      <div className={scrollClass}><Notice {...action} /><LoadState query={bank} /><LoadState query={sources} variant="inline" /><Select label={t('qeCategory')} value={categoryFilter} values={[{ value: '', label: t('qeAllCategories') }, { value: '__uncategorized__', label: t('qeUncategorized') }, ...bankCategories.map(category => ({ value: category.id, label: category.name }))]} onChange={setCategoryFilter} /><input className={styles.partFilter} type="search" placeholder={t('qeFilterQuestions')} aria-label={t('qeFilterQuestions')} value={filter} onChange={e => setFilter(e.target.value)} />
        {bank.data?.filter(q => q.user_id === quiz.user_id && q.content.toLowerCase().includes(filter.toLowerCase()) && (!categoryFilter || (q.category?.id ?? '__uncategorized__') === categoryFilter)).map(q => <div className={`${styles.partCard} ${included.has(q.id) ? styles.usedQuestion : ''}`} key={q.id}><div className={styles.partCardBody}><div className={styles.partText}><p>{q.content || t('qeUntitledQuestion')}</p><small>{t(typeLabels[q.type])} · {q.category?.name || t('qeUncategorized')}</small></div><button type="button" className={styles.icon} aria-label={`${t('quizAddQuestion')}: ${q.content}`} disabled={action.busy || !linked.isSuccess || !sources.isSuccess || included.has(q.id)} onClick={() => void action.run(async () => { await request(`/${quiz.id}/questions`, 'POST', { question_id: q.id, position: nextPosition(linked.data!, sources.data!), max_points: 1 }); })}>{AddSVG}</button></div></div>)}
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
  const { t } = useI18n(), categoryAccess = useAccess('categories');
  const categories = useAll<Category>('/question-categories', 'categories', categoryAccess.read);
  const [rows, setRows] = useState<Source[]>(initial);
  const fixed = useAll<Candidate>(`/${quiz.id}/questions`, 'questions');
  const [baseline, setBaseline] = useState(JSON.stringify(initial)), [editing, setEditing] = useState<{ index: number; row: Source } | null>(null);
  const action = useAction(), { confirm, dialogProps } = useConfirm();
  const update = (next: Source[]) => { setRows(next); onDirty(JSON.stringify(next) !== baseline); };
  const choices = [...new Map([...(initial.flatMap(s => s.category ? [{ ...s.category, user_id: quiz.user_id }] : [])), ...(categories.data ?? [])].map(g => [g.id, g])).values()].filter(g => g.user_id === quiz.user_id);
  const valid = allocationValid(rows);
  return <>
    <div className={scrollClass}><h4 className={styles.partHeading}>{t('quizSourcesButton')} <span>{rows.length}</span></h4><Notice {...action} />
      {categoryAccess.read && <LoadState query={categories} variant="inline" />}
      {rows.map((row, index) => <PartCard key={`${index}:${row.category_id}`} title={row.category_id === null ? t('qeUncategorized') : choices.find(g => g.id === row.category_id)?.name || row.category?.name || row.category_id} meta={<>{t('quizQuestionsCount', { count: row.question_count })} · {t('qePointsPerQuestion')}: {row.max_points}</>} editable={editable} busy={action.busy} onEdit={() => setEditing({ index, row })} onRemove={() => void (async () => {
        if (await confirm({ title: t('quizRemove'), message: t('quizDeleteSourceMessage'), yesText: t('quizRemove'), noText: t('adminCancel') })) update(rows.filter((_, i) => i !== index));
      })()}><small>{t('qePosition')}: {row.position}</small></PartCard>)}
      {!rows.length && <p className={styles.partEmpty}>{t('quizNoSourcesYet')}</p>}
      {editable && <AddButton disabled={action.busy || !fixed.isSuccess || rows.length >= 1000} onClick={() => setEditing({ index: rows.length, row: { category_id: '', position: nextPosition(rows, fixed.data ?? []), question_count: 1, max_points: 1 } })}>{t('quizAddSource')}</AddButton>}
      <LoadState query={fixed} variant="inline" />
      {fixed.data && <p className={styles.partMeta}>{t('quizQuestionCount')}: {questionCount(fixed.data, rows)} · {t('qeDerivedCountHelp')}</p>}
      {!valid && <p className={styles.error}>{t('qeAllocationInvalid')}</p>}
    </div><Footer onBack={onBack} busy={action.busy}>{editable && <button type="button" className="saveCaptionsBtn" disabled={action.busy || !valid || JSON.stringify(rows) === baseline} onClick={() => void action.run(async () => {
      const result = await request<{ sources: Source[] }>(`/${quiz.id}/sources`, 'PUT', { sources: rows.map(({ category_id, position, max_points, question_count }) => ({ category_id, position, max_points, question_count })) });
      setRows(result.sources); setBaseline(JSON.stringify(result.sources)); onDirty(false);
    })}>{t(action.busy ? 'saving' : 'saveChanges')}</button>}</Footer>
    {editing && <DraftDialog<NumberDraft<Source>> title={t(editing.index < rows.length ? 'quizEditSource' : 'quizAddSource')} initial={editing.row} onClose={() => setEditing(null)} valid={draft => draft.category_id === null || !!draft.category_id} save={async draft => {
      const next = [...rows]; next[editing.index] = { ...draft, position: Number(draft.position), max_points: Number(draft.max_points), question_count: Number(draft.question_count), category: choices.find(g => g.id === draft.category_id) }; update(next);
    }}>{(draft, change) => <>
      <Field label={t('qeCategory')}><Select label={t('qeCategory')} value={draft.category_id ?? '__uncategorized__'} values={[{ value: '', label: t('quizSelect'), disabled: true }, { value: '__uncategorized__', label: t('qeUncategorized'), disabled: rows.some((s, i) => i !== editing.index && s.category_id === null) }, ...choices.map(g => ({ value: g.id, label: g.name, disabled: rows.some((s, i) => i !== editing.index && s.category_id === g.id) }))]} onChange={value => change({ category_id: value === '__uncategorized__' ? null : value })} /></Field>
      <div className="quizPopupGrid"><Field label={t('quizQuestionCount')}><input aria-label={t('quizQuestionCount')} type="number" required min={1} max={2147483647} step={1} value={draft.question_count} onChange={e => change({ question_count: numberDraftValue(e.target.value) })} /></Field>
      <Field label={t('qePointsPerQuestion')}><input aria-label={t('qePointsPerQuestion')} type="number" required min={0.01} max={99999999.99} step={0.01} value={draft.max_points} onChange={e => change({ max_points: numberDraftValue(e.target.value) })} /></Field>
      <Position value={draft.position} change={position => change({ position })} /></div><p className={styles.note}>{t('qeSharedPositionHelp')}</p>
    </>}</DraftDialog>}<ConfirmDialog {...dialogProps} />
  </>;
}

function RuleVideoField({ video, ownerId, included, onChange }: {
  video: VideoCard; ownerId: string; included: string[]; onChange: (video: VideoCard) => void;
}) {
  const { t } = useI18n();
  const [choosing, setChoosing] = useState(false);
  const thumbnail = video.thumbnail_url || video.mux_thumbnail_url;
  return <>
    <Field label={t('quizRequiredVideo')}>
      <div className={styles.ruleVideo}>
        <div className={styles.partIdentity}>
          {thumbnail && <img className={styles.partThumbnail} src={thumbnail} alt="" />}
          <div className={styles.partText}><p>{video.title}</p></div>
        </div>
        <button type="button" className="cancelBtn" onClick={() => setChoosing(true)}>{t('qeChangeVideo')}</button>
      </div>
    </Field>
    <EditorPopup open={choosing} title={t('qeChangeVideo')} description={t('quizSelectVideoForRule')} onClose={() => setChoosing(false)} wide className={styles.rulePopup}>
      <div className={`${scrollClass} ${styles.ruleVideoPicker}`}><PlaylistVideoPicker ownerId={ownerId} included={[...included, video.id]} busy={false} addingId={null} onAdd={next => { onChange(next); setChoosing(false); }} /></div>
      <Footer onBack={() => setChoosing(false)} />
    </EditorPopup>
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
    <EditorPopup open={adding} title={t('quizAddRule')} description={t('quizSelectVideoForRule')} onClose={() => setAdding(false)} wide className={styles.rulePopup}>
      <div className={`${scrollClass} ${styles.ruleVideoPicker}`}><PlaylistVideoPicker ownerId={quiz.user_id} included={query.data?.map(r => r.video_id) ?? []} busy={!query.isSuccess} addingId={null} onAdd={selectVideo} /></div><Footer onBack={() => setAdding(false)} />
    </EditorPopup>
    {editing && <DraftDialog<NumberDraft<{ mode: string; value: number; video: VideoCard }>> className={styles.rulePopup} title={t(editing.isNew ? 'quizAddRule' : 'quizEditRule')} initial={{ mode: editing.row.min_watch_percentage !== null ? 'percentage' : 'seconds', value: Number(editing.row.min_watch_percentage ?? editing.row.min_watch_seconds), video: editing.row.video_card ?? { id: editing.row.video_id, title: t('quizRequiredVideo') } }} onClose={() => setEditing(null)} save={async draft => {
      const patch = { min_watch_percentage: draft.mode === 'percentage' ? Number(draft.value) : null, min_watch_seconds: draft.mode === 'seconds' ? Number(draft.value) : null };
      await saveRequirement(request, editing.row, editing.isNew, draft.video.id, patch, t('qeRuleReplacementIncomplete'));
    }}>{(draft, change) => <>
      <RuleVideoField video={draft.video} ownerId={quiz.user_id} included={(query.data ?? []).filter(row => row.video_id !== editing.row.video_id).map(row => row.video_id)} onChange={video => change({ video })} />
      <Field label={t('quizRuleType')}><Select label={t('quizRuleType')} value={draft.mode} values={[{ value: 'percentage', label: t('quizVideoWatchPercentage') }, { value: 'seconds', label: t('quizVideoWatchSeconds') }]} onChange={mode => change({ mode, value: mode === 'percentage' ? 100 : 1 })} /></Field>
      <Field label={t(draft.mode === 'percentage' ? 'quizRequiredPercentage' : 'quizRequiredSeconds')}><input aria-label={t(draft.mode === 'percentage' ? 'quizRequiredPercentage' : 'quizRequiredSeconds')} required type="number" min={draft.mode === 'percentage' ? 0.01 : 1} max={draft.mode === 'percentage' ? 100 : draft.video.duration_seconds ?? 2147483647} step={draft.mode === 'percentage' ? 0.01 : 1} value={draft.value} onChange={e => change({ value: numberDraftValue(e.target.value) })} /></Field>
    </>}</DraftDialog>}<ConfirmDialog {...dialogProps} />
  </>;
}
