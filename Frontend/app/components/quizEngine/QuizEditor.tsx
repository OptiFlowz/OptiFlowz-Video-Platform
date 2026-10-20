import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useI18n } from '~/i18n';
import { ConfirmDialog } from '~/components/confirmPopup/confirmDialog';
import { useConfirm } from '~/components/confirmPopup/useConfirm';
import { Field, Select, Notice, LoadState, useAction, useAccess, useDetail, styles } from './shared';
import { request, all } from './api';
import { defaultSettings, settingsOf, type Quiz, type QuizSettings, type Candidate, type Question, type Source } from './model';
import { readiness } from './readiness';
import { Candidates, Sources, Requirements } from './QuizParts';
import { EditorPresentationContext } from './EditorPopup';
import { numberDraftValue, type NumberDraft } from './numberDraft';

export default function QuizEditor({ id, onSaved, onDirty, onClose }: { id: string; onSaved: (id: string) => void; onDirty: (dirty: boolean) => void; onClose: () => void }) {
  const { t } = useI18n();
  const setPresentation = useContext(EditorPresentationContext);
  const detail = useDetail<{ quiz: Quiz }>(`/${id}`, id !== 'new');
  const access = useAccess('quizzes', detail.data?.quiz);
  const [tab, setTab] = useState('settings'), dirty = useRef(false);
  const { confirm, dialogProps } = useConfirm();
  const track = (value: boolean) => { dirty.current = value; onDirty(value); };
  useEffect(() => { setTab('settings'); }, [id]);
  useEffect(() => {
    setPresentation?.(tab === 'settings' ? null : {
      title: t(tab === 'candidates' ? 'quizEditQuestions' : tab === 'sources' ? 'quizQuestionSources' : 'quizRulesTitle'),
      description: tab === 'candidates' ? t('qeCandidatesHelp') : tab === 'sources' ? t('qeSourcesHelp') : t('quizRulesDescription', { title: detail.data?.quiz.title || t('quizThisQuiz') }),
      wide: true,
    });
    return () => setPresentation?.(null);
  }, [tab, t, detail.data?.quiz.title, setPresentation]);
  if (id !== 'new' && !detail.data) return <LoadState query={detail} variant="form" />;
  const quiz = detail.data?.quiz;
  const changeTab = async (value: string) => {
    if (dirty.current && !await confirm({ title: t('qeUnsaved'), message: t('qeDiscard'), yesText: t('qeDiscardAction'), noText: t('adminCancel') })) return;
    track(false); setTab(value);
  };
  return <>
    {tab === 'settings' ? <Settings key={id} initial={quiz} onSaved={onSaved} onDirty={track} onClose={onClose} manage={quiz ? <div className="quizPopupManageActions">
      <button type="button" className="saveCaptionsBtn" onClick={() => void changeTab('candidates')}>{t('quizQuestionsButton')}</button>
      <button type="button" className="saveCaptionsBtn" onClick={() => void changeTab('sources')}>{t('quizSourcesButton')}</button>
      <button type="button" className="saveCaptionsBtn" onClick={() => void changeTab('requirements')}>{t('quizRulesButton')}</button>
    </div> : undefined} /> : <>
      {quiz && tab === 'candidates' && <Candidates quiz={quiz} editable={access.update} onDirty={track} onBack={() => void changeTab('settings')} />}
      {quiz && tab === 'sources' && <Sources quiz={quiz} editable={access.update} onDirty={track} onBack={() => void changeTab('settings')} />}
      {quiz && tab === 'requirements' && <Requirements quiz={quiz} editable={access.update} onBack={() => void changeTab('settings')} />}
    </>}
    <ConfirmDialog {...dialogProps} />
  </>;

}
async function inspectQuiz(id: string, settings: QuizSettings) {
  const [candidates, sources] = await Promise.all([all<Candidate>(`/${id}/questions`, 'questions'), all<Source>(`/${id}/sources`, 'sources')]);
  const questions: Question[] = [];
  // Keep requests bounded when a bank contains hundreds of candidate questions.
  for (let i = 0; i < candidates.length; i += 8) {
    const batch = await Promise.all(candidates.slice(i, i + 8).map(row => request<{ question: Question }>(`/questions/${row.question_id}`)));
    questions.push(...batch.map(result => result.question));
  }
  return readiness(settings, questions, sources);
}
function Settings({ initial, onSaved, onDirty, onClose, manage }: { initial?: Quiz; onSaved: (id: string) => void; onDirty: (dirty: boolean) => void; onClose: () => void; manage?: ReactNode }) {
  const { t } = useI18n(), access = useAccess('quizzes', initial);
  const [form, setForm] = useState<NumberDraft<QuizSettings>>(() => initial ? settingsOf(initial) : { ...defaultSettings });
  const [baseline, setBaseline] = useState(JSON.stringify(form)), [issues, setIssues] = useState<string[] | null>(null);
  const body = useRef<HTMLDivElement>(null), readinessPanel = useRef<HTMLDetailsElement>(null);
  const scrollToBottom = () => body.current?.scrollTo({ top: body.current.scrollHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  useEffect(() => { if (issues && readinessPanel.current?.open) scrollToBottom(); }, [issues]);
  const action = useAction(), editable = initial ? access.update : access.create;
  const change = (patch: Partial<NumberDraft<QuizSettings>>) => { const next = { ...form, ...patch }; setForm(next); setIssues(null); onDirty(JSON.stringify(next) !== baseline); };
  const settings = (): QuizSettings => ({ ...form,
    question_count: Number(form.question_count),
    time_limit_seconds: form.time_limit_seconds === null ? null : Number(form.time_limit_seconds),
    max_attempts: form.max_attempts === null ? null : Number(form.max_attempts),
    passing_score_percentage: Number(form.passing_score_percentage),
    min_answered_percentage: Number(form.min_answered_percentage),
    min_correct_percentage: Number(form.min_correct_percentage),
  });
  const number = (key: keyof QuizSettings, label: string, min: number, max: number, nullable = false, step = 1) => <Field key={key} label={t(label)} hint={nullable ? t('qeUnlimitedHelp') : undefined}><input required={!nullable} aria-label={t(label)} type="number" min={min} max={max} step={step} value={form[key] === null ? '' : String(form[key])} onChange={e => change({ [key]: e.target.value === '' && nullable ? null : numberDraftValue(e.target.value) })} /></Field>;
  const toggle = (key: keyof QuizSettings, label: string) => <label className={`quizPopupToggleRow ${styles.check}`} key={key}><div><strong>{t(label)}</strong>{['quizShuffleQuestions', 'quizShuffleOptions', 'quizHasCertificate'].includes(label) && <span>{t(`${label}Help`)}</span>}</div><input type="checkbox" checked={!!form[key]} onChange={e => change({ [key]: e.target.checked })} /></label>;
  const feedback = (key: 'correctness_visibility' | 'correct_answers_visibility' | 'explanation_visibility', label: string) => <Field key={key} label={t(label)}><Select label={t(label)} value={form[key]} values={[{ value: 'never', label: t('qeNever') }, { value: 'after_check', label: t('qeAfterCheck') }, { value: 'after_finish', label: t('qeAfterFinish') }]} onChange={value => change({ [key]: value })} /></Field>;
  return <form className={`quizPopupForm ${styles.settingsForm}`} onSubmit={e => { e.preventDefault(); void action.run(async () => {
    if (!form.title.trim()) throw new Error(t('quizTitleRequired'));
    if (initial && form.question_count !== initial.question_count) {
      const sources = await all<Source>(`/${initial.id}/sources`, 'sources');
      if (sources.some(s => s.question_count !== null)) throw new Error(t('qeCountChange'));
    }
    if (form.status === 'published') {
      if (!initial) throw new Error(t('qePublishAfterCreate'));
      const problems = await inspectQuiz(initial.id, settings()); setIssues(problems);
      if (problems.length) throw new Error(t('qeNotReady'));
    }
    const body = { ...settings(), title: form.title.trim(), description: form.description?.trim() || null };
    const result = await request<{ quiz: Quiz }>(initial ? `/${initial.id}` : '', initial ? 'PATCH' : 'POST', body);
    const saved = settingsOf(result.quiz); setForm(saved); setBaseline(JSON.stringify(saved)); onDirty(false); onSaved(result.quiz.id);
  }); }}>
    <div ref={body} className="quizPopupBody"><Notice {...action} /><fieldset disabled={action.busy || !editable}>
      <Field label={t('title')}><input required maxLength={255} aria-label={t('title')} value={form.title} onChange={e => change({ title: e.target.value })} /></Field>
      <Field label={t('description')}><textarea aria-label={t('description')} value={form.description ?? ''} onChange={e => change({ description: e.target.value || null })} /></Field>
      <div className="quizPopupGrid"><Field label={t('adminTableStatus')}><Select label={t('adminTableStatus')} value={form.status} values={['draft', 'published', 'archived'].map(value => ({ value, label: t(`qe${value[0].toUpperCase()}${value.slice(1)}`), disabled: !initial && value === 'published' }))} onChange={value => change({ status: value as QuizSettings['status'] })} /></Field>
      {number('question_count', 'quizQuestionCount', 1, 2147483647)}
      {number('time_limit_seconds', 'quizTimeLimitSeconds', 1, 2147483647, true)}
      {number('max_attempts', 'quizMaxAttempts', 1, 2147483647, true)}
      {number('passing_score_percentage', 'quizPassingScore', 0, 100, false, 0.01)}
      {number('min_answered_percentage', 'qeMinAnswered', 0, 100, false, 0.01)}
      {number('min_correct_percentage', 'qeMinCorrect', 0, 100, false, 0.01)}
      </div><h4 className={styles.sectionTitle}>{t('qeFeedback')}</h4><div className="quizPopupGrid">
      <Field label={t('quizScoring')}><Select label={t('quizScoring')} value={form.scoring_mode} values={[{ value: 'exact_match', label: t('quizScoringStrict') }, { value: 'partial_credit', label: t('quizScoringPartial') }]} onChange={value => change({ scoring_mode: value as QuizSettings['scoring_mode'] })} /></Field>
      {feedback('correctness_visibility', 'qeCorrectness')}{feedback('correct_answers_visibility', 'quizCorrectAnswer')}{feedback('explanation_visibility', 'quizExplanation')}
      </div><h4 className={`${styles.sectionTitle} ${styles.toggleTitle}`}>{t('settingsAdvancedTab')}</h4><div className="quizPopupToggleList">{toggle('explanation_incorrect_only', 'qeIncorrectOnly')}{toggle('allow_answer_changes_after_check', 'qeAnswerChanges')}{toggle('allow_attempt_review', 'qeReview')}{toggle('show_final_score', 'qeFinalScore')}
      {toggle('shuffle_questions', 'quizShuffleQuestions')}{toggle('shuffle_options', 'quizShuffleOptions')}{toggle('has_certificate', 'quizHasCertificate')}
    </div></fieldset>
    {initial && <details ref={readinessPanel} className={styles.readiness} onToggle={event => { if (event.currentTarget.open) scrollToBottom(); }}><summary>{t('qeReadiness')}</summary><p className={styles.note}>{t('qeReadinessHelp')}</p><button type="button" className={styles.button} disabled={action.busy} onClick={() => void action.run(async () => { setIssues(await inspectQuiz(initial.id, settings())); }, false)}>{t('qeCheck')}</button>
      {issues && (issues.length ? <ul>{issues.map(key => <li className={styles.error} key={key}>{t(key)}</li>)}</ul> : <p className={styles.success}>{t('qeReady')}</p>)}
    </details>}
    </div>
    <fieldset disabled={action.busy}>{manage}</fieldset>
    <div className="quizPopupActions"><button type="button" className="cancelBtn" disabled={action.busy} onClick={onClose}>{t('adminCancel')}</button>
      {initial && access.can('quizzes.participate') && initial.status === 'published' && JSON.stringify(form) === baseline && !action.busy && <Link className="cancelBtn" to={`/quiz/${initial.id}`}>{t('quizView')}</Link>}
      {editable && <button type="submit" className="saveCaptionsBtn" disabled={action.busy || (!!initial && JSON.stringify(form) === baseline)}>{action.busy ? t('saving') : t(initial ? 'quizSaveQuiz' : 'quizCreateQuiz')}</button>}
    </div>
  </form>;
}
