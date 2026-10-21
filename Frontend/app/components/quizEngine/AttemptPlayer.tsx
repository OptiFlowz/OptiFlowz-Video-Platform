import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useI18n } from '~/i18n';
import { CheckSVG, CloseSVG, QuizSVG } from '~/constants';
import { getToken } from '~/functions';
import { useConfirm } from '~/components/confirmPopup/useConfirm';
import { ConfirmDialog } from '~/components/confirmPopup/confirmDialog';
import { engineKey } from './api';
import { LoadState, Select, styles } from './shared';
import { attemptRequest, isCompleteAnswer, type AttemptSettings, type Answer, type AttemptQuestion, type AttemptQuestions, type AttemptResult, type SavedAnswer } from './attemptApi';

export default function AttemptPlayer({ attemptId, onClose, onFinished, completedAttempt, settings, headerActions }: { headerActions?: HTMLElement | null; settings?: AttemptSettings; attemptId: string; onClose: () => void; onFinished: () => void; completedAttempt?: AttemptResult }) {
  const { t } = useI18n(), client = useQueryClient(), { confirm, dialogProps } = useConfirm();
  const [index, setIndex] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [submittedResult, setResult] = useState<AttemptResult | null>(null), [now, setNow] = useState(Date.now);
  const knownResult = submittedResult ?? completedAttempt ?? null;
  const knownSettings = knownResult?.settings ?? settings;
  const lock = useRef(false);
  const queryKey = [...engineKey, getToken(), knownResult ? 'attempt-review' : 'attempt', attemptId];
  const query = useQuery({ queryKey, queryFn: ({ signal }) => attemptRequest<AttemptQuestions>(attemptId, '/questions', 'GET', undefined, signal), retry: false, refetchOnWindowFocus: false, enabled: !knownResult || knownSettings?.allow_attempt_review === true });
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const data = query.data;
  const result = knownResult ?? data?.result ?? null;
  const attemptSettings = data?.settings ?? knownSettings;
  const reviewing = !!result || data?.status === 'submitted' || data?.status === 'timed_out';
  const canReview = attemptSettings?.allow_attempt_review === true;
  const questions = reviewing && !canReview ? [] : data?.questions ?? [], question = questions[index];
  const remaining = data?.expires_at ? Math.max(0, Math.ceil((Date.parse(data.expires_at) - now) / 1000)) : null;
  const expired = !!data?.is_expired || remaining === 0 || data?.status === 'timed_out';
  const answered = questions.filter(q => q.checked_at).length;
  async function save(answer: Answer): Promise<boolean> {
    if (!question || reviewing || expired || lock.current) return false;
    lock.current = true; setBusy(true); setError('');
    try {
      const saved = await attemptRequest<SavedAnswer>(attemptId, `/answers/${question.question_no}`, 'PUT', { answer });
      // Reflect the acknowledged save even if the subsequent permissions refresh fails.
      client.setQueryData<AttemptQuestions>(queryKey, current => current && ({ ...current, questions: current.questions.map(q => q.question_no === saved.question_no ? { ...q, ...saved, can_edit: false } : q) }));
      const refreshed = await query.refetch();
      if (refreshed.error) throw refreshed.error;
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('quizFailedSaveAnswer'));
      if ((cause as { body?: { code?: string } }).body?.code === 'ATTEMPT_EXPIRED') client.setQueryData<AttemptQuestions>(queryKey, current => current && ({ ...current, is_expired: true }));
      return false;
    } finally { lock.current = false; setBusy(false); }
  }
  async function submit() {
    if (lock.current || reviewing || expired) return;
    if (!await confirm({ intent: 'primary', title: t('quizFinishAttempt'), message: t('quizAnsweredCount', { answered: client.getQueryData<AttemptQuestions>(queryKey)?.questions.filter(q => q.checked_at).length ?? answered, total: questions.length }), yesText: t('quizFinishAttempt'), noText: t('quizContinueQuiz') })) return;
    lock.current = true; setBusy(true); setError('');
    try { setResult(await attemptRequest<AttemptResult>(attemptId, '/submit', 'POST')); setIndex(0); onFinished(); }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : t('quizFailedSubmitAttempt'));
      if ((cause as { body?: { code?: string } }).body?.code === 'ATTEMPT_EXPIRED') client.setQueryData<AttemptQuestions>(queryKey, current => current && ({ ...current, is_expired: true }));
      // Refresh authoritative status after a timeout, conflict or lost response.
      void query.refetch(); onFinished();
    } finally { lock.current = false; setBusy(false); }
  }
  const resultSummary = result ? <section className={`${styles.panel} ${styles.attemptResult}`} data-outcome={result.passed === true ? 'passed' : result.passed === false ? 'failed' : 'complete'} aria-live="polite">
    <div className={styles.resultArtwork} aria-hidden="true">
      <span className={styles.resultOrbit} /><span className={styles.resultOrbit} />
      {result.passed === true && Array.from({ length: 8 }, (_, i) => <span key={i} className={styles.resultSpark} style={{ rotate: `${i * 45}deg`, animationDelay: `${i * 70}ms` }} />)}
      <span className={styles.resultEmblem}>{result.passed === true ? CheckSVG : result.passed === false ? CloseSVG : QuizSVG}</span>
    </div>
    <div className={styles.resultCopy}>
      <p className={styles.resultEyebrow}>{t('quizComplete')}</p>
      <h2>{t(result.passed === true ? 'quizCongrats' : result.passed === false ? 'quizNotPassedLabel' : 'quizComplete')}</h2>
      <p className={styles.muted}>{t(result.passed === true ? 'qeResultPassed' : result.passed === false ? 'qeResultFailed' : 'qeResultComplete')}</p>
      {result.passed === true && <span className={styles.resultStatus}>{t('quizPassedLabel')}</span>}
      <button className={`${styles.button} ${styles.primary}`} onClick={onClose}>{t('quizBackToAttempts')}</button>
    </div>
    {result.score_percentage != null && <div className={styles.resultScoreCard}>
      <p>{t('quizScoreLabel')}</p><strong className={styles.attemptScore}>{result.score_percentage}%</strong>
      {result.earned_points != null && <p>{t('quizPointsScore', { score: result.earned_points, total: result.max_points })}</p>}
    </div>}
  </section> : null;
  if (result && !canReview) return resultSummary;
  return <>{resultSummary}<section className={`${styles.attemptPlayer} ${reviewing ? styles.attemptReview : ''}`} aria-busy={busy}>
    <div className={`${styles.toolbar} ${reviewing ? styles.attemptReviewHeader : ''}`}>
      {reviewing && <h2>{t('quizReviewAttempt')}</h2>}
      <span>{t('quizAnsweredCount', { answered, total: questions.length })}</span>
      {!reviewing && remaining !== null && <span role="timer">{t('quizTimeLeft')} <strong className={styles.attemptTimeValue}>{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</strong></span>}
    </div>
    <LoadState query={query} />
    {expired && !result && <p className={styles.note} role="status">{t('qeTimedOut')}</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {question && <QuestionStep key={question.question_no} question={question} questions={questions} onNavigate={target => { setError(''); setIndex(target); }} reviewing={reviewing} showCheck={reviewing ? questions.some(q => typeof q.feedback.is_correct === 'boolean') : attemptSettings?.correctness_visibility === 'after_check'} index={index} total={questions.length} busy={busy} expired={expired}
      onSave={save} onPrevious={() => { setError(''); setIndex(i => i - 1); }} onNext={() => { setError(''); setIndex(i => i + 1); }} onFinish={submit} onClose={onClose} headerActions={headerActions} />}
    {query.isSuccess && !questions.length && <p>{t('quizNoQuestionsYet')}</p>}
    {!question && headerActions && createPortal(<button className={styles.button} onClick={onClose}>{t('quizBackToQuiz')}</button>, headerActions)}
    <ConfirmDialog {...dialogProps} />
  </section></>;
}

function QuestionStep({ question, questions, onNavigate, reviewing, showCheck, index, total, busy, expired, onSave, onPrevious, onNext, onFinish, onClose, headerActions }: {
  headerActions?: HTMLElement | null; reviewing: boolean;
  question: AttemptQuestion; questions: AttemptQuestion[]; onNavigate: (index: number) => void; showCheck: boolean; index: number; total: number; busy: boolean; expired: boolean;
  onSave: (answer: Answer) => Promise<boolean>; onPrevious: () => void; onNext: () => void; onFinish: () => Promise<void>; onClose: () => void;
}) {
  const { t } = useI18n(), { confirm, dialogProps } = useConfirm();
  const [answer, setAnswer] = useState<Answer | null>(question.answer);
  const changed = JSON.stringify(answer) !== JSON.stringify(question.answer);
  const editable = question.can_edit && !reviewing && !busy && !expired;
  const complete = isCompleteAnswer(question, answer);
  const feedback = question.feedback;
  const showFeedback = !!question.checked_at && ((showCheck && (feedback.is_correct !== undefined || feedback.awarded_points !== undefined)) || !!feedback.correct_answers?.options?.length || !!feedback.correct_answers?.matching_items?.length || !!feedback.explanation);
  useEffect(() => {
    if (!changed) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [changed]);
  const move = async (next: () => void) => {
    if (changed && !reviewing && !expired && (!complete || !await onSave(answer!))) return;
    next();
  };
  const close = async () => {
    if (changed && !await confirm({ title: t('qeUnsaved'), message: t('qeDiscard'), yesText: t('qeDiscardAction'), noText: t('adminCancel') })) return;
    onClose();
  };
  return <div className={styles.attemptLayout}>
    <nav className={styles.attemptNavigation} aria-label={t('quizQuestionsButton')}>
      <h2>{t('quizQuestionsButton')}</h2>
      <div className={styles.attemptQuestionGrid}>{questions.map((item, target) => {
        const state = !item.checked_at ? 'unanswered' : showCheck && typeof item.feedback?.is_correct === 'boolean' ? (item.feedback.is_correct ? 'correct' : 'incorrect') : 'answered';
        const label = `${t('quizQuestionPosition', { current: target + 1, total })} · ${t(state === 'correct' ? 'quizCorrect' : state === 'incorrect' ? 'quizIncorrect' : state === 'answered' ? 'quizAnsweredLabel' : 'quizNotAnsweredYet')}`;
        return <button type="button" key={item.question_no} aria-label={label} title={label} aria-current={target === index ? 'step' : undefined}
          data-state={state} data-answered={!!item.checked_at} disabled={busy || (target !== index && changed && !complete && !expired)}
          onClick={() => { if (target !== index) void move(() => onNavigate(target)); }}>
          {target + 1}
        </button>;
      })}</div>
      <div className={styles.attemptNavigationLegend}>
        <span><i data-state="answered" aria-hidden="true" />{t('quizAnsweredLabel')}</span>
        {showCheck && <><span><i data-state="correct" aria-hidden="true" />{t('quizCorrect')}</span><span><i data-state="incorrect" aria-hidden="true" />{t('quizIncorrect')}</span></>}
      </div>
    </nav>
    <div className={styles.attemptStep}>
    <article className={`${styles.panel} ${styles.attemptQuestion}`}>
      <div className={styles.toolbar}><span className={styles.badge}>{t('quizQuestionPosition', { current: index + 1, total })}</span>{showCheck && <span className={styles.muted}>{t('quizPoints')}: {question.max_points}</span>}</div>
      <h2>{question.content}</h2>
      {reviewing ? !question.checked_at && <p className={styles.muted}>{t('quizNotAnsweredYet')}</p> : <p className={styles.muted}>{t(question.type === 'matching' ? 'quizMatchHint' : question.type === 'single_choice' ? 'quizSelectOneHint' : 'quizSelectMultipleHint')}</p>}
      {question.type === 'matching' ? <div className={styles.attemptMatches}>{question.matching_items.map(item => <div className={styles.attemptMatch} key={item.item_no}>
        <span>{item.content}</span><Select label={item.content} value={answer && 'pairs' in answer ? answer.pairs.find(p => p.item_no === item.item_no)?.option_no ?? '' : ''} disabled={!editable}
          values={[{ value: '', label: t('quizChooseAnswer') }, ...question.matching_options.map(o => ({ value: o.option_no, label: o.content }))]}
          onChange={value => setAnswer(current => ({ pairs: [...(current && 'pairs' in current ? current.pairs.filter(p => p.item_no !== item.item_no) : []), ...(value ? [{ item_no: item.item_no, option_no: Number(value) }] : [])].sort((a, b) => a.item_no - b.item_no) }))} />
      </div>)}</div> : <div className={styles.attemptOptions} role="group" aria-label={question.content}>{question.options.map(option => {
        const selected = !!answer && ('option_no' in answer ? answer.option_no === option.option_no : 'option_nos' in answer && answer.option_nos.includes(option.option_no));
        return <label className={styles.attemptOption} data-selected={selected} key={option.option_no}><input type={question.type === 'single_choice' ? 'radio' : 'checkbox'} name={`question-${question.question_no}`} checked={selected} disabled={!editable}
          onChange={() => setAnswer(current => question.type === 'single_choice' ? { option_no: option.option_no } : { option_nos: (current && 'option_nos' in current ? selected ? current.option_nos.filter(n => n !== option.option_no) : [...current.option_nos, option.option_no] : [option.option_no]).sort((a, b) => a - b) })} /><span>{option.content}</span></label>;
      })}</div>}
      {showFeedback && <div className={styles.attemptFeedback} aria-live="polite">
        {showCheck && feedback.is_correct !== undefined && <p className={feedback.is_correct ? styles.success : styles.error}>{t(feedback.is_correct ? 'quizCorrect' : 'quizIncorrect')}</p>}
        {showCheck && feedback.awarded_points !== undefined && <p>{t('quizPointsScore', { score: feedback.awarded_points, total: question.max_points })}</p>}
        {feedback.correct_answers?.options && <p>{t('quizCorrectAnswerValue', { value: question.options.filter(o => feedback.correct_answers!.options!.some(correct => correct.option_no === o.option_no && correct.is_correct)).map(o => o.content).join(', ') })}</p>}
        {feedback.correct_answers?.matching_items && <><h3>{t('quizCorrectMatches')}</h3>{feedback.correct_answers.matching_items.map(pair => <p key={pair.item_no}>{question.matching_items.find(i => i.item_no === pair.item_no)?.content} → {question.matching_options.find(o => o.option_no === pair.correct_option_no)?.content}</p>)}</>}
        {feedback.explanation && <><h3>{t('quizExplanation')}</h3><p>{feedback.explanation}</p></>}
      </div>}
      <div className={styles.attemptActions}>
        <button className={styles.button} disabled={busy || index === 0 || (changed && !complete && !expired)} onClick={() => void move(onPrevious)}>{t('quizPreviousQuestion')}</button>
        {!reviewing && showCheck && <button className={`${styles.button} ${styles.primary}`} disabled={!editable || !complete || (!!question.checked_at && !changed)} onClick={() => void onSave(answer!)}>{t(busy ? 'saving' : 'quizCheckAnswer')}</button>}
        {index < total - 1 ? <button className={styles.button} disabled={busy || (changed && !complete && !expired)} onClick={() => void move(onNext)}>{t('quizNextQuestion')}</button> : !reviewing && <button className={`${styles.button} ${styles.primary}`} disabled={busy || expired || (changed && !complete)} onClick={async () => { if (!changed || await onSave(answer!)) await onFinish(); }}>{t('quizFinishAttempt')}</button>}
      </div>
    </article>
    {headerActions && createPortal(<button className={styles.button} disabled={busy} onClick={() => void close()}>{t('quizBackToQuiz')}</button>, headerActions)}
    </div>
    <ConfirmDialog {...dialogProps} />
  </div>;
}
