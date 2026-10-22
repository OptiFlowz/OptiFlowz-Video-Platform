import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useI18n } from '~/i18n';
import { ArrowSVG, CheckSVG, CloseSVG, QuizSVG } from '~/constants';
import { formatDescription, getToken } from '~/functions';
import { useConfirm } from '~/components/confirmPopup/useConfirm';
import { ConfirmDialog } from '~/components/confirmPopup/confirmDialog';
import { engineKey } from './api';
import { AnswerSaveQueue, type SaveStatus } from './AnswerSaveQueue';
import { LoadState, Select, styles } from './shared';
import { attemptRequest, isCompleteAnswer, type AttemptSettings, type Answer, type AttemptQuestion, type AttemptQuestions, type AttemptResult, type SavedAnswer } from './attemptApi';

export default function AttemptPlayer({ attemptId, onClose, onFinished, completedAttempt, settings, headerActions }: { headerActions?: HTMLElement | null; settings?: AttemptSettings; attemptId: string; onClose: () => void; onFinished: () => void; completedAttempt?: AttemptResult }) {
  const { t } = useI18n(), client = useQueryClient(), { confirm, dialogProps } = useConfirm();
  const [index, setIndex] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [submittedResult, setResult] = useState<AttemptResult | null>(null), [now, setNow] = useState(Date.now);
  const knownResult = submittedResult ?? completedAttempt ?? null;
  const knownSettings = knownResult?.settings ?? settings;
  const lock = useRef(false), submissionVersion = useRef(0);
  const [confirming, setConfirming] = useState(false);
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
  const answered = questions.filter(q => isCompleteAnswer(q, q.answer)).length;
  async function check(question: AttemptQuestion): Promise<boolean> {
    if (!question || reviewing || expired || lock.current) return false;
    lock.current = true; setBusy(true); setError('');
    try {
      const saved = await attemptRequest<SavedAnswer>(attemptId, `/answers/${question.question_no}/check`, 'POST');
      // The check response includes authoritative feedback and edit permissions.
      client.setQueryData<AttemptQuestions>(queryKey, current => current && ({ ...current, questions: current.questions.map(q => q.question_no === saved.question_no ? { ...q, ...saved } : q) }));
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('quizFailedSaveAnswer'));
      if ((cause as { body?: { code?: string } }).body?.code === 'ATTEMPT_EXPIRED') client.setQueryData<AttemptQuestions>(queryKey, current => current && ({ ...current, is_expired: true }));
      return false;
    } finally { lock.current = false; setBusy(false); }
  }
  async function saveDraft(question: AttemptQuestion, answer: Answer): Promise<void> {
    if (reviewing || expired) throw new Error(t('qeTimedOut'));
    try {
      const saved = await attemptRequest<SavedAnswer>(attemptId, `/answers/${question.question_no}`, 'PUT', { answer });
      client.setQueryData<AttemptQuestions>(queryKey, current => current && ({ ...current, questions: current.questions.map(q => q.question_no === saved.question_no ? { ...q, ...saved } : q) }));
    } catch (cause) {
      if ((cause as { body?: { code?: string } }).body?.code === 'ATTEMPT_EXPIRED') client.setQueryData<AttemptQuestions>(queryKey, current => current && ({ ...current, is_expired: true }));
      throw cause;
    }
  }
  async function submit(automatic = false) {
    if (lock.current || reviewing || expired || (data?.expires_at && Date.parse(data.expires_at) <= Date.now())) return;
    const version = submissionVersion.current;
    if (!automatic) {
      setConfirming(true);
      let accepted: boolean;
      try { accepted = await confirm({ intent: 'primary', title: t('quizFinishAttempt'), message: t('quizAnsweredCount', { answered: client.getQueryData<AttemptQuestions>(queryKey)?.questions.filter(q => isCompleteAnswer(q, q.answer)).length ?? answered, total: questions.length }), yesText: t('quizFinishAttempt'), noText: t('quizContinueQuiz') }); }
      finally { setConfirming(false); }
      // An automatic submission can supersede an open confirmation dialog.
      if (!accepted || version !== submissionVersion.current || lock.current || (data?.expires_at && Date.parse(data.expires_at) <= Date.now())) return;
    }
    submissionVersion.current++;
    if (automatic && confirming) dialogProps.onNo();
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
    <AttemptStatusBar reviewing={reviewing}>
      {reviewing && <h2>{t('quizReviewAttempt')}</h2>}
      <span>{t('quizAnsweredCount', { answered, total: questions.length })}</span>
      {!reviewing && remaining !== null && <span role="timer">{t('quizTimeLeft')} <strong className={styles.attemptTimeValue}>{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</strong></span>}
    </AttemptStatusBar>
    <LoadState query={query} />
    {expired && !result && <p className={styles.note} role="status">{t('qeTimedOut')}</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {question && <QuestionPage key={attemptId} questions={questions} onNavigate={target => { setError(''); setIndex(target); }} reviewing={reviewing} showCheck={reviewing ? questions.some(q => typeof q.feedback.is_correct === 'boolean') : attemptSettings?.correctness_visibility === 'after_check'} index={index} pageSize={attemptSettings?.questions_per_page ?? 1} busy={busy} expired={expired} expiresAt={data?.expires_at ?? null} confirming={confirming}
      onCheck={check} onSaveDraft={saveDraft} onFinish={submit} onClose={onClose} headerActions={headerActions} />}
    {query.isSuccess && !questions.length && <p>{t('quizNoQuestionsYet')}</p>}
    {!question && headerActions && createPortal(<button className={`${styles.button} ${styles.attemptBackLink}`} onClick={onClose}>{t('quizBackToQuiz')}</button>, headerActions)}
    <ConfirmDialog {...dialogProps} />
  </section></>;
}

/** Share the measured status height with the sticky navigation and question scroll targets. */
function AttemptStatusBar({ reviewing, children }: { reviewing: boolean; children: ReactNode }) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = bar.current, player = element?.parentElement;
    if (!element || !player) return;
    const header = document.querySelector<HTMLElement>('header[data-app-header]');
    const measure = () => {
      player.style.setProperty('--attempt-status-height', `${element.getBoundingClientRect().height}px`);
      if (header) player.style.setProperty('--attempt-header-height', `${Math.max(0, header.getBoundingClientRect().bottom)}px`);
    };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    if (header) observer?.observe(header);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); player.style.removeProperty('--attempt-status-height'); player.style.removeProperty('--attempt-header-height'); };
  }, []);
  return <div ref={bar} className={`${styles.toolbar} ${styles.attemptStatusBar} ${reviewing ? styles.attemptReviewHeader : ''}`}>{children}</div>;
}

function QuestionPage({ questions, onNavigate, reviewing, showCheck, index, pageSize, busy, expired, expiresAt, confirming, onCheck, onSaveDraft, onFinish, onClose, headerActions }: {
  headerActions?: HTMLElement | null; reviewing: boolean; questions: AttemptQuestion[]; onNavigate: (index: number) => void;
  showCheck: boolean; index: number; pageSize: number; busy: boolean; expired: boolean; expiresAt: string | null; confirming: boolean;
  onSaveDraft: (question: AttemptQuestion, answer: Answer) => Promise<void>;
  onCheck: (question: AttemptQuestion) => Promise<boolean>; onFinish: (automatic?: boolean) => Promise<void>; onClose: () => void;
}) {
  const { t } = useI18n(), { confirm, dialogProps } = useConfirm();
  const [drafts, setDrafts] = useState<Record<number, Answer>>({});
  const draftsRef = useRef(drafts);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const writer = useRef(onSaveDraft); writer.current = onSaveDraft;
  const alive = useRef(true);
  const [autosave] = useState(() => new AnswerSaveQueue(({ question, answer }) => writer.current(question, answer), status => { if (alive.current) setSaveStatus(status); }));
  useEffect(() => {
    alive.current = true;
    const retry = () => { if (autosave.hasPending) void autosave.flush(); };
    window.addEventListener('online', retry);
    return () => { alive.current = false; window.removeEventListener('online', retry); };
  }, [autosave]);
  const updateAnswer = (question: AttemptQuestion, update: (current: Answer | null) => Answer) => {
    const answer = update(draftsRef.current[question.question_no] ?? question.answer);
    draftsRef.current = { ...draftsRef.current, [question.question_no]: answer };
    setDrafts(draftsRef.current);
    autosave.enqueue(question, answer);
  };
  const [moving, setMoving] = useState(false);
  const operation = useRef(false), scrollTarget = useRef<number | null>(null);
  const automaticAttempted = useRef(false);
  const automaticFinish = useRef<() => boolean>(() => false);
  automaticFinish.current = () => {
    if (reviewing || expired || automaticAttempted.current) return true;
    if ((operation.current && !confirming) || busy) return false;
    automaticAttempted.current = true;
    operation.current = true; setMoving(true);
    void (async () => {
      try {
        // PUT and submit share a server deadline: flush first, then submit before it.
        if (await autosave.flush() && alive.current && expiresAt && Date.now() < Date.parse(expiresAt)) await onFinish(true);
      } finally {
        operation.current = false;
        if (alive.current) setMoving(false);
      }
    })();
    return true;
  };
  useEffect(() => {
    if (reviewing || expired || !expiresAt) return;
    const deadline = Date.parse(expiresAt);
    if (!Number.isFinite(deadline) || deadline <= Date.now()) return;
    let timer: ReturnType<typeof setTimeout>;
    const finish = () => {
      const left = deadline - Date.now();
      if (left <= 0) return;
      // Reserve the final second for the network request; never submit a resumed expired attempt.
      if (left > 1000) timer = setTimeout(finish, Math.min(left - 1000, 2147483647));
      else if (!automaticFinish.current()) timer = setTimeout(finish, Math.min(100, left));
    };
    finish();
    return () => clearTimeout(timer);
  }, [expiresAt, reviewing, expired]);
  const cards = useRef(new Map<number, HTMLElement>());
  const total = questions.length;
  const size = Number.isInteger(pageSize) && pageSize > 0 ? Math.min(pageSize, total) : 1;
  const start = Math.floor(index / size) * size, end = Math.min(start + size, total);
  const visible = questions.slice(start, end), multiple = size > 1, unavailable = busy || moving;
  const answerOf = (question: AttemptQuestion) => drafts[question.question_no] ?? question.answer;
  const changed = (question: AttemptQuestion) => JSON.stringify(answerOf(question)) !== JSON.stringify(question.answer);
  const needsCheck = (question: AttemptQuestion) => !reviewing && showCheck && !expired && (changed(question) || !question.checked_at || (question.feedback.is_correct === false && question.can_edit));
  const pendingCheck = visible.some(needsCheck);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (autosave.hasPending) event.preventDefault(); };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [autosave]);
  useEffect(() => {
    if (scrollTarget.current === null) return;
    const card = cards.current.get(scrollTarget.current);
    if (card) { card.scrollIntoView?.({ block: 'start' }); card.focus({ preventScroll: true }); scrollTarget.current = null; }
  }, [index]);
  const run = async (work: () => Promise<void>) => {
    if (operation.current || busy) return;
    operation.current = true; setMoving(true);
    try { await work(); } finally { operation.current = false; setMoving(false); }
  };
  const check = async (question: AttemptQuestion) => {
    if (!await autosave.flush()) return false;
    const answer = answerOf(question);
    if (!isCompleteAnswer(question, answer) || !await onCheck(question)) return false;
    const next = { ...draftsRef.current }; delete next[question.question_no]; draftsRef.current = next; setDrafts(next);
    return true;
  };
  const move = (next: () => void | Promise<void>) => run(async () => {
    if (!reviewing && !expired) {
      // Navigation and submit wait for every queued save, including partial answers.
      if (!await autosave.flush()) return;
    }
    await next();
  });
  const navigate = (target: number) => {
    const go = () => { scrollTarget.current = questions[target].question_no; onNavigate(target); };
    // Jumping within this page keeps all drafts and focuses the requested card.
    if (target >= start && target < end) { if (!unavailable) go(); }
    else void move(go);
  };
  const close = () => run(async () => {
    if (expired && autosave.hasPending) {
      if (await confirm({ title: t('qeUnsaved'), message: t('qeDiscard'), yesText: t('qeDiscardAction'), noText: t('adminCancel') })) onClose();
      return;
    }
    if (!await autosave.flush()) return;
    onClose();
  });
  const checkButton = (question: AttemptQuestion) => <button className={`${styles.button} ${styles.primary}`} disabled={unavailable || !question.can_edit || !isCompleteAnswer(question, answerOf(question)) || (!!question.checked_at && !changed(question))} onClick={() => void run(async () => { await check(question); })}>{t(busy ? 'saving' : 'quizCheckAnswer')}</button>;
  const navigation = <div className={styles.attemptActions}>
    <button className={styles.button} disabled={unavailable || start === 0} onClick={() => navigate(Math.max(0, start - size))}><span className={`${styles.attemptNavArrow} ${styles.attemptPreviousArrow}`} aria-hidden="true">{ArrowSVG}</span>{t(multiple ? 'quizPreviousPage' : 'quizPreviousQuestion')}</button>
    {!multiple && pendingCheck ? checkButton(visible[0]) : end < total ? <button className={`${styles.button} ${styles.primary}`} disabled={unavailable || pendingCheck} onClick={() => navigate(end)}>{t(multiple ? 'quizNextPage' : 'quizNextQuestion')}<span className={styles.attemptNavArrow} aria-hidden="true">{ArrowSVG}</span></button> : !reviewing && <button className={`${styles.button} ${styles.primary}`} disabled={unavailable || expired || pendingCheck} onClick={() => void move(onFinish)}>{t('quizFinishAttempt')}</button>}
  </div>;
  return <div className={styles.attemptLayout}>
    <nav className={styles.attemptNavigation} aria-label={t('quizQuestionsButton')}>
      <h2>{t('quizQuestionsButton')}</h2>
      <div className={styles.attemptQuestionGrid}>{questions.map((item, target) => {
        const state = !item.checked_at || changed(item) ? (isCompleteAnswer(item, answerOf(item)) ? 'answered' : 'unanswered') : showCheck && typeof item.feedback?.is_correct === 'boolean' ? (item.feedback.is_correct ? 'correct' : 'incorrect') : 'answered';
        const label = `${t('quizQuestionPosition', { current: target + 1, total })} · ${t(state === 'correct' ? 'quizCorrect' : state === 'incorrect' ? 'quizIncorrect' : state === 'answered' ? 'quizAnsweredLabel' : 'quizNotAnsweredYet')}`;
        return <button type="button" key={item.question_no} aria-label={label} title={label} aria-current={target === index ? 'step' : undefined}
          data-state={state} data-answered={state !== 'unanswered'} disabled={unavailable}
          onClick={() => { if (target !== index) navigate(target); }}>
          {target + 1}
        </button>;
      })}</div>
      <div className={styles.attemptNavigationLegend}>
        <span><i data-state="answered" aria-hidden="true" />{t('quizAnsweredLabel')}</span>
        {showCheck && <><span><i data-state="correct" aria-hidden="true" />{t('quizCorrect')}</span><span><i data-state="incorrect" aria-hidden="true" />{t('quizIncorrect')}</span></>}
      </div>
      {!reviewing && <div className={styles.autosaveStatus} role={saveStatus === 'error' ? 'alert' : 'status'} aria-live="polite">
        <span className={saveStatus === 'error' ? styles.error : styles.muted}>{saveStatus === 'idle' ? '' : t(saveStatus === 'saving' ? 'quizAutoSaving' : saveStatus === 'error' ? 'quizAutoSaveFailed' : 'quizAutoSaved')}</span>
        {saveStatus === 'error' && <button className={styles.button} disabled={unavailable || expired} onClick={() => void autosave.flush()}>{t('quizRetrySave')}</button>}
      </div>}
    </nav>
    <div className={`${styles.attemptStep} ${styles.attemptQuestionPage}`}>
      {visible.map((question, offset) => <QuestionCard key={question.question_no} question={question} answer={answerOf(question)} setAnswer={update => updateAnswer(question, update)}
        index={start + offset} total={total} reviewing={reviewing} showCheck={showCheck} busy={unavailable} expired={expired}
        cardRef={node => { if (node) cards.current.set(question.question_no, node); else cards.current.delete(question.question_no); }}>
        {multiple ? needsCheck(question) && <div className={`${styles.attemptActions} ${styles.attemptCheckAction}`}>{checkButton(question)}</div> : navigation}
      </QuestionCard>)}
      {multiple && navigation}
      {headerActions && createPortal(<button className={`${styles.button} ${styles.attemptBackLink}`} disabled={unavailable} onClick={() => void close()}>{t('quizBackToQuiz')}</button>, headerActions)}
    </div>
    <ConfirmDialog {...dialogProps} />
  </div>;
}

function QuestionCard({ question, answer, setAnswer, index, total, reviewing, showCheck, busy, expired, cardRef, children }: {
  question: AttemptQuestion; answer: Answer | null; setAnswer: (update: (current: Answer | null) => Answer) => void;
  index: number; total: number; reviewing: boolean; showCheck: boolean; busy: boolean; expired: boolean;
  cardRef: (node: HTMLElement | null) => void; children: ReactNode;
}) {
  const { t } = useI18n();
  const changed = JSON.stringify(answer) !== JSON.stringify(question.answer);
  const editable = question.can_edit && !reviewing && !busy && !expired;
  const feedback = question.feedback;
  const showFeedback = !changed && !!question.checked_at && ((showCheck && (feedback.is_correct !== undefined || feedback.awarded_points !== undefined)) || !!feedback.correct_answers?.options?.length || !!feedback.correct_answers?.matching_items?.length || !!feedback.explanation);
  return <article ref={cardRef} tabIndex={-1} aria-label={t('quizQuestionPosition', { current: index + 1, total })} className={`${styles.panel} ${styles.attemptQuestion}`}>
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
        {feedback.explanation && <section className={styles.attemptExplanation}><h3>{t('quizExplanation')}</h3><div>{formatDescription(feedback.explanation)}</div></section>}
      </div>}
      {children}
    </article>;
}
