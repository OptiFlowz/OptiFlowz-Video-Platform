import { useContext, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useI18n } from '~/i18n';
import ProfileTabs from '~/components/library/ProfileTabs';
import { Field, Select, Notice, LoadState, useAction, useAccess, useDetail, styles } from './shared';
import { request } from './api';
import { defaultSettings, settingsOf, type Quiz, type QuizSettings } from './model';
import { inspectQuiz } from './inspectQuiz';
import { Candidates, Sources, Requirements } from './QuizParts';
import { EditorBusyStatusContext } from './EditorPopup';
import { numberDraftValue, type NumberDraft } from './numberDraft';

const editorTabs = { settings: 'qeSettings', questions: 'quizQuestionsButton', sources: 'quizSourcesButton', rules: 'quizRulesButton' };
export default function QuizEditor({ id, section, onSectionChange, onSaved, onDirty, onClose }: {
  id: string; section: string; onSectionChange: (section: string) => void; onSaved: (id: string) => void; onDirty: (dirty: boolean) => void; onClose: () => void;
}) {
  const { t } = useI18n(), busy = useContext(EditorBusyStatusContext);
  const detail = useDetail<{ quiz: Quiz }>(`/${id}`, id !== 'new');
  const access = useAccess('quizzes', detail.data?.quiz), quiz = detail.data?.quiz;
  const tab = id === 'new' || !Object.hasOwn(editorTabs, section) ? 'settings' : section as keyof typeof editorTabs;
  return <div className={`${styles.page} ${styles.editorPage}`}>
    <div className="libraryHeader"><div className="libraryHeading"><h1>{quiz?.title || t(id === 'new' ? 'quizCreateTitle' : 'quizEditTitle')}</h1><p>{t(id === 'new' ? 'qePublishAfterCreate' : 'qeIntro')}</p></div>{quiz && <span className={`managementStatus ${quiz.status === 'published' ? 'active' : ''}`}>{t(`qe${quiz.status[0].toUpperCase()}${quiz.status.slice(1)}`)}</span>}</div>
    <ProfileTabs className={styles.resourceTabs} label={t('qeSettings')}>{Object.entries(editorTabs).map(([key, label]) => <button type="button" role="tab" key={key} id={`quiz-tab-${key}`} aria-selected={tab === key} aria-controls="quiz-editor-panel" disabled={busy || (key !== 'settings' && !quiz)} onClick={() => { if (tab !== key) onSectionChange(key); }}>{t(label)}</button>)}</ProfileTabs>
    <div id="quiz-editor-panel" role="tabpanel" aria-labelledby={`quiz-tab-${tab}`} className={styles.editorBody}>
      {id !== 'new' && !detail.data ? <LoadState query={detail} variant="form" /> : <>
        {tab === 'settings' && <Settings key={id} initial={quiz} onSaved={onSaved} onDirty={onDirty} onClose={onClose} />}
        {quiz && tab === 'questions' && <><p className={styles.sectionHelp}>{t('qeCandidatesHelp')}</p><Candidates quiz={quiz} editable={access.update} onDirty={onDirty} /></>}
        {quiz && tab === 'sources' && <><p className={styles.sectionHelp}>{t('qeSourcesHelp')}</p><Sources quiz={quiz} editable={access.update} onDirty={onDirty} /></>}
        {quiz && tab === 'rules' && <><p className={styles.sectionHelp}>{t('quizRulesDescription', { title: quiz.title })}</p><Requirements quiz={quiz} editable={access.update} /></>}
      </>}
    </div>
  </div>;
}

function Settings({ initial, onSaved, onDirty, onClose }: { initial?: Quiz; onSaved: (id: string) => void; onDirty: (dirty: boolean) => void; onClose: () => void }) {
  const { t } = useI18n(), access = useAccess('quizzes', initial);
  const [form, setForm] = useState<NumberDraft<QuizSettings>>(() => initial ? settingsOf(initial) : { ...defaultSettings });
  const [baseline, setBaseline] = useState(JSON.stringify(form)), [issues, setIssues] = useState<string[] | null>(null);
  const readinessPanel = useRef<HTMLDetailsElement>(null);
  const scrollToBottom = () => readinessPanel.current?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  useEffect(() => { if (issues && readinessPanel.current?.open) scrollToBottom(); }, [issues]);
  const action = useAction(), editable = initial ? access.update : access.create;
  const change = (patch: Partial<NumberDraft<QuizSettings>>) => { const next = { ...form, ...patch }; setForm(next); setIssues(null); onDirty(JSON.stringify(next) !== baseline); };
  const settings = (): QuizSettings => ({ ...form,
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
    if (form.status === 'published') {
      if (!initial) throw new Error(t('qePublishAfterCreate'));
      const problems = await inspectQuiz(initial); setIssues(problems);
      if (problems.length) throw new Error(t('qeNotReady'));
    }
    const body = { ...settings(), title: form.title.trim(), description: form.description?.trim() || null };
    const result = await request<{ quiz: Quiz }>(initial ? `/${initial.id}` : '', initial ? 'PATCH' : 'POST', body);
    const saved = settingsOf(result.quiz); setForm(saved); setBaseline(JSON.stringify(saved)); onDirty(false); onSaved(result.quiz.id);
  }); }}>
    <div className="quizPopupBody"><Notice {...action} /><div className={styles.settingsLayout}><div className={styles.settingsColumn}><fieldset disabled={action.busy || !editable}><section className={styles.settingsSection}><h2>{t('qeSettings')}</h2>
      <Field label={t('title')}><input required maxLength={255} aria-label={t('title')} value={form.title} onChange={e => change({ title: e.target.value })} /></Field>
      <Field label={t('description')}><textarea aria-label={t('description')} value={form.description ?? ''} onChange={e => change({ description: e.target.value || null })} /></Field>
      <div className="quizPopupGrid"><Field label={t('adminTableStatus')}><Select label={t('adminTableStatus')} value={form.status} values={['draft', 'published', 'archived'].map(value => ({ value, label: t(`qe${value[0].toUpperCase()}${value.slice(1)}`), disabled: !initial && value === 'published' }))} onChange={value => change({ status: value as QuizSettings['status'] })} /></Field>
      <Field label={t('quizQuestionCount')} hint={t('qeDerivedCountHelp')}><output className={styles.derivedCount}>{initial?.question_count ?? 0}</output></Field>
      {number('time_limit_seconds', 'quizTimeLimitSeconds', 1, 2147483647, true)}
      {number('max_attempts', 'quizMaxAttempts', 1, 2147483647, true)}
      {number('passing_score_percentage', 'quizPassingScore', 0, 100, false, 0.01)}
      {number('min_answered_percentage', 'qeMinAnswered', 0, 100, false, 0.01)}
      {number('min_correct_percentage', 'qeMinCorrect', 0, 100, false, 0.01)}
      </div></section></fieldset>{initial && <details ref={readinessPanel} className={`${styles.settingsSection} ${styles.readiness}`} onToggle={event => { if (event.currentTarget.open) scrollToBottom(); }}><summary>{t('qeReadiness')}</summary><p className={styles.note}>{t('qeReadinessHelp')}</p><button type="button" className={styles.button} disabled={action.busy} onClick={() => void action.run(async () => { setIssues(await inspectQuiz(initial)); }, false)}>{t('qeCheck')}</button>
      {issues && (issues.length ? <ul>{issues.map(key => <li className={styles.error} key={key}>{t(key)}</li>)}</ul> : <p className={styles.success}>{t('qeReady')}</p>)}
    </details>}</div><fieldset className={styles.settingsColumn} disabled={action.busy || !editable}><section className={styles.settingsSection}><h2>{t('qeFeedback')}</h2><div className="quizPopupGrid">
      <Field label={t('quizScoring')}><Select label={t('quizScoring')} value={form.scoring_mode} values={[{ value: 'exact_match', label: t('quizScoringStrict') }, { value: 'partial_credit', label: t('quizScoringPartial') }]} onChange={value => change({ scoring_mode: value as QuizSettings['scoring_mode'] })} /></Field>
      {feedback('correctness_visibility', 'qeCorrectness')}{feedback('correct_answers_visibility', 'quizCorrectAnswer')}{feedback('explanation_visibility', 'quizExplanation')}
      </div></section><section className={styles.settingsSection}><h2>{t('settingsAdvancedTab')}</h2><div className="quizPopupToggleList">{toggle('explanation_incorrect_only', 'qeIncorrectOnly')}{toggle('allow_answer_changes_after_check', 'qeAnswerChanges')}{toggle('allow_attempt_review', 'qeReview')}{toggle('show_final_score', 'qeFinalScore')}
      {toggle('shuffle_questions', 'quizShuffleQuestions')}{toggle('shuffle_options', 'quizShuffleOptions')}{toggle('has_certificate', 'quizHasCertificate')}
    </div></section></fieldset></div>

    </div>
    <div className="quizPopupActions"><button type="button" className="cancelBtn" disabled={action.busy} onClick={onClose}>{t('navQuizzes')}</button>
      {initial && access.can('quizzes.participate') && initial.status === 'published' && JSON.stringify(form) === baseline && !action.busy && <Link className="cancelBtn" to={`/quiz/${initial.id}`}>{t('quizView')}</Link>}
      {editable && <button type="submit" className="saveCaptionsBtn" disabled={action.busy || (!!initial && JSON.stringify(form) === baseline)}>{action.busy ? t('saving') : t(initial ? 'quizSaveQuiz' : 'quizCreateQuiz')}</button>}
    </div>
  </form>;
}
