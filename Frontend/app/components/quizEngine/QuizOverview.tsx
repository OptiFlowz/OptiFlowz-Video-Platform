'use client';
import '~/styles/editor.css';
import '~/styles/quiz.css';
import '~/styles/quizExperience.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useI18n } from '~/i18n';
import { getToken } from '~/functions';
import InfiniteScroll from '~/components/library/infiniteScroll';
import { nextResultsPage, uniqueResults } from '~/components/library/infiniteResults';
import { engineKey, list, request } from './api';
import { useDetail, useAccess, LoadState, styles } from './shared';
import type { Quiz, Requirement } from './model';
import AttemptPlayer from './AttemptPlayer';
import type { AttemptSettings } from './attemptApi';
import { ArrowSVG, CheckSVG, CloseSVG, PlaySVG, QuizSVG } from '~/constants';

type Eligibility = { can_start: boolean; can_resume: boolean; reason: string | null; active_attempt_id: string | null; attempts_used: number | null; max_attempts: number | null; attempts_remaining: number | null };
type Attempt = { settings?: AttemptSettings; id: string; attempt_no: number; status: string; started_at: string; expires_at: string | null; finished_at: string | null; max_points: number; earned_points: number | null; score_percentage: number | null; passed: boolean | null };
const statusLabels: Record<string, string> = { in_progress: 'quizInProgress', submitted: 'quizComplete', timed_out: 'qeTimedOut', cancelled: 'qeCancelled' };
const historyLimit = 8;

export default function QuizOverview() {
  const { quizId = '' } = useParams(), { t, locale } = useI18n(), { user, can, read } = useAccess('quizzes');
  const navigate = useNavigate(), [params] = useSearchParams();
  const attemptId = params.get('attempt');
  const [attemptActions, setAttemptActions] = useState<HTMLDivElement | null>(null);
  const [starting, setStarting] = useState(false), [startError, setStartError] = useState('');
  const startLock = useRef(false);
  const [startedAttempt, setStartedAttempt] = useState<{ id: string; settings?: AttemptSettings } | null>(null);
  // Quiz metadata is an authoring endpoint; participant-only accounts must not request it.
  const detail = useDetail<{ quiz: Quiz }>(`/${quizId}`, !!quizId && read);
  const quiz = detail.data?.quiz;
  const title = quiz?.title || t('quizDefaultTitle');
  const openAttempt = (id: string) => navigate(`/quiz/${quizId}?${new URLSearchParams({ attempt: id })}`);
  const token = getToken();
  const eligibility = useDetail<Eligibility>(`/${quizId}/eligibility`, !!quizId);
  const progress = useDetail<{ requirements_met: boolean; requirements: Requirement[] }>(`/quiz-requirements/${quizId}/progress`, !!quizId && eligibility.isSuccess && eligibility.data.reason !== 'quiz_unavailable');
  const attempts = useInfiniteQuery({
    queryKey: [...engineKey, token, user?.id, 'attempt-history', quizId], enabled: !!quizId && !!token,
    initialPageParam: 1,
    queryFn: ({ signal, pageParam }) => list<Attempt>(`/${quizId}/attempts`, 'attempts', { page: pageParam, limit: historyLimit, sortOrder: 'desc', sortBy: 'started_at' }, signal),
    getNextPageParam: (lastPage, pages, page) => nextResultsPage(lastPage, pages, page, historyLimit, result => result.items),
    retry: false,
  });
  const history = uniqueResults(attempts.data?.pages.flatMap(page => page.items) ?? []);
  const { hasNextPage, isFetching, fetchNextPage } = attempts;
  const loadedPageCount = attempts.data?.pages.length ?? 0;
  // Re-arm the sentinel even when a cached/fast page finishes in one render.
  const loadMore = useCallback(() => { if (loadedPageCount && hasNextPage && !isFetching) void fetchNextPage(); }, [loadedPageCount, hasNextPage, isFetching, fetchNextPage]);
  const refresh = () => { void eligibility.refetch(); if (progress.isEnabled) void progress.refetch(); void attempts.refetch(); };
  const start = async () => {
    if (startLock.current) return;
    if (eligibility.data?.can_resume && eligibility.data.active_attempt_id) { openAttempt(eligibility.data.active_attempt_id); return; }
    if (!eligibility.data?.can_start) return;
    startLock.current = true; setStarting(true); setStartError('');
    try { const attempt = await request<{ id: string; settings?: AttemptSettings }>(`/${quizId}/attempts`, 'POST'); setStartedAttempt(attempt); openAttempt(attempt.id); refresh(); }
    catch (cause) { setStartError(cause instanceof Error ? cause.message : t('quizFailedStartAttempt')); refresh(); }
    finally { startLock.current = false; setStarting(false); }
  };
  const timeLimit = quiz?.time_limit_seconds;
  const minutes = timeLimit ? Math.max(1, Math.round(timeLimit / 60)) : 0;
  const hours = Math.floor(minutes / 60), remainder = minutes % 60;
  const timeLabel = timeLimit === undefined ? '—' : !timeLimit ? t('quizNoTimeLimit') : hours > 0
    ? `${t(hours === 1 ? 'quizHour' : 'quizHours', { count: hours })}${remainder ? ` ${t('quizMinutesShort', { count: remainder })}` : ''}`
    : t(minutes === 1 ? 'quizMinute' : 'quizMinutes', { count: minutes });
  const canResume = !!eligibility.data?.can_resume;

  return <main className="videoQuizPage quizExperience"><div className="videoQuizPageContent introStage">
    <div className="videoQuizTop"><div className="videoQuizHeaderRow">
      <div className="videoQuizHeading"><span className="videoQuizBadge" aria-hidden="true">{QuizSVG}</span><span><h1>{title}</h1><p>{t('quizIntroSubtitle')}</p></span></div>
      {attemptId ? <div className={`videoQuizTopActions ${styles.page}`} ref={setAttemptActions} /> : <div className="videoQuizTopActions"><button type="button" className="videoQuizCloseButton" aria-label={t('quizCloseQuiz')} onClick={() => navigate(read ? '/quizzes' : '/')}>{CloseSVG}</button></div>}
    </div></div>
    {attemptId ? <div className={styles.page}><AttemptPlayer key={attemptId} headerActions={attemptActions} attemptId={attemptId} settings={(startedAttempt?.id === attemptId ? startedAttempt : history.find(attempt => attempt.id === attemptId))?.settings} completedAttempt={history.find(attempt => attempt.id === attemptId && ['submitted', 'timed_out'].includes(attempt.status))} onClose={() => { navigate(`/quiz/${quizId}`); refresh(); }} onFinished={refresh} /></div> : <>
      <LoadState query={eligibility} />
      {eligibility.data?.reason === 'quiz_unavailable' ? <p className={styles.note}>{t('quizNoQuizAvailable')}</p> : <div className="videoQuizIntro">
        <aside className="videoQuizStartPanel" aria-labelledby="quiz-start-title">
          <div className="videoQuizStartHeading"><h3 id="quiz-start-title">{t(canResume ? 'quizContinueQuiz' : 'quizBeforeYouBegin')}</h3><p>{t(canResume ? 'quizResumeHint' : 'quizStartHint')}</p></div>
          <dl className="videoQuizFacts">
            <div><dt>{t('quizQuestions')}</dt><dd>{quiz?.question_count ?? '—'}</dd></div>
            <div><dt>{t('quizTimeLimitLabel')}</dt><dd>{timeLabel}</dd></div>
            <div><dt>{t('quizPassingScoreLabel')}</dt><dd>{quiz?.passing_score_percentage != null ? `${quiz.passing_score_percentage}%` : '—'}</dd></div>
            <div><dt>{t('quizAttemptsLabel')}</dt><dd>{!eligibility.data ? '—' : eligibility.data.attempts_remaining != null ? t('quizAttemptsLeft', { count: eligibility.data.attempts_remaining }) : eligibility.data.max_attempts === null ? t('quizUnlimitedLabel') : '—'}</dd></div>
          </dl>
          {quiz?.has_certificate && <div className="videoQuizCertificateNote"><span aria-hidden="true">{CheckSVG}</span>{t('quizCertificateHint')}</div>}
          {eligibility.data?.reason === 'requirements_not_met' && <p className={styles.overviewStartHint}>{t('quizCompleteRequiredVideos')}</p>}
          {eligibility.data?.reason === 'max_attempts_reached' && <p className={styles.overviewStartHint}>{t('quizNoAttemptsLeft')}</p>}
          {startError && <p role="alert" className={styles.error}>{startError}</p>}
          <div className="videoQuizFooterActions videoQuizStartActions"><button type="button" className="videoQuizPrimaryButton" disabled={starting || !can('quizzes.participate') || (!eligibility.data?.can_start && !canResume)} onClick={() => void start()}>{t(starting ? 'quizStarting' : canResume ? 'quizContinueQuiz' : 'quizStartQuiz')}{ArrowSVG}</button></div>
        </aside>
        <div className={styles.overviewMain}>
          {quiz?.description && <section className="videoQuizDescription"><p>{quiz.description}</p></section>}
          <LoadState query={progress} />
          {!!progress.data?.requirements.length && <section className={styles.overviewRequirements} aria-labelledby="quiz-requirements-title">
            <h3 id="quiz-requirements-title">{t('quizRequirements')}</h3>
            <div className={styles.overviewRequirementList}>{progress.data.requirements.map(row => {
              const seconds = (value: number) => new Intl.NumberFormat(locale === 'sr' ? 'sr-Latn' : locale, { style: 'unit', unit: 'second', unitDisplay: 'long', maximumFractionDigits: 0 }).format(value);
              return <div key={row.video_id} className={styles.overviewRequirement}>
                {row.video_card && (row.video_card.thumbnail_url || row.video_card.mux_thumbnail_url) && <img className={styles.overviewRequirementImage} src={row.video_card.thumbnail_url || row.video_card.mux_thumbnail_url || ''} alt="" />}
                <div className={styles.overviewRequirementContent}><strong>{row.video_card?.title || t('quizRequiredVideo')}</strong>
                  <p>{row.min_watch_percentage != null ? t('quizRequirementPercentProgress', { watched: row.watched_percentage ?? 0, required: row.min_watch_percentage }) : t('quizRequirementTimeProgress', { watched: seconds(row.total_watch_seconds ?? 0), required: seconds(row.required_watch_seconds ?? row.min_watch_seconds ?? 0) })}</p>
                  {row.completion_percentage != null && <progress className={styles.overviewRequirementProgress} value={row.completion_percentage} max={100} aria-label={row.video_card?.title || t('quizWatchRequirement')} />}
                </div>
                {row.is_met ? <span className={styles.overviewRequirementComplete}>{CheckSVG}{t('quizRequirementComplete')}</span> : row.video_card && <Link className="videoQuizInlineButton videoQuizAttemptViewButton" to={`/video/${row.video_id}`}>{t('quizWatch')}{ArrowSVG}</Link>}
              </div>;
            })}</div>
          </section>}
          <section className="videoQuizHistory" aria-labelledby="quiz-history-title">
            <div className="videoQuizSectionTitle"><span><h3 id="quiz-history-title">{t('quizYourLastAttempts')}</h3><p>{t('quizHistoryHint')}</p></span>
              {can('quizzes.certificates') && quiz?.has_certificate && history.some(attempt => attempt.passed) && <Link to="/account" className="viewQuizCertificate">{t('quizViewCertificates')}</Link>}
            </div>
            {!attempts.data && <LoadState query={attempts} />}
            {!!history.length && <div className="videoQuizAttemptList">{history.map(attempt => {
              const inProgress = attempt.status === 'in_progress';
              const status = inProgress ? 'in_progress' : attempt.passed === true ? 'passed' : attempt.passed === false ? 'failed' : 'not_checked';
              const date = attempt.finished_at || attempt.started_at;
              return <div key={attempt.id} className="videoQuizAttemptCard">
                <span className={`videoQuizStatusIcon ${status}`} aria-hidden="true">{inProgress ? PlaySVG : attempt.passed === true ? CheckSVG : attempt.passed === false ? CloseSVG : QuizSVG}</span>
                <div className="videoQuizAttemptText"><strong>{t('quizAttemptNumber', { count: attempt.attempt_no })}</strong><time dateTime={date}>{new Date(date).toLocaleDateString(locale === 'sr' ? 'sr-Latn' : locale, { month: 'short', day: 'numeric', year: 'numeric' })}</time></div>
                <div className="videoQuizAttemptScore">{inProgress ? <AttemptProgress expiresAt={attempt.expires_at} /> : <><strong>{attempt.earned_points != null ? `${attempt.earned_points}/${attempt.max_points}` : attempt.score_percentage != null ? `${attempt.score_percentage}%` : '—'}</strong><span className={`videoQuizAttemptStatus ${status}`}>{t(attempt.passed === true ? 'quizPassedLabel' : attempt.passed === false ? 'quizNotPassedLabel' : statusLabels[attempt.status] ?? 'quizNotChecked')}</span></>}</div>
                {(inProgress || ['submitted', 'timed_out'].includes(attempt.status)) && <button type="button" className="videoQuizInlineButton videoQuizAttemptViewButton" onClick={() => openAttempt(attempt.id)}>{t(inProgress ? 'quizContinue' : 'quizView')}{ArrowSVG}</button>}
              </div>;
            })}</div>}
            {attempts.isSuccess && !history.length && <p className={styles.overviewEmptyHistory}>{t('quizNoAttemptsYet')}</p>}
            <InfiniteScroll hasMore={!!hasNextPage} fetching={isFetching} error={attempts.isFetchNextPageError} onLoadMore={loadMore} loadingLabel={t('quizLoadingQuiz')} />
          </section>
        </div>
      </div>}
    </>}
  </div></main>;
}

function AttemptProgress({ expiresAt }: { expiresAt: string | null }) {
  const { t } = useI18n();
  const [now, setNow] = useState(Date.now);
  const deadline = expiresAt ? Date.parse(expiresAt) : null;
  const remaining = deadline !== null && Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;
  useEffect(() => {
    if (deadline === null || !Number.isFinite(deadline) || deadline <= Date.now()) return;
    const timer = window.setInterval(() => {
      const time = Date.now();
      setNow(time);
      if (time >= deadline) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [deadline]);
  return <><strong>{remaining === null ? t('quizNoTimeLimit') : <span role="timer">{t('quizTimeLeft')} <span className={styles.attemptTimeValue}>{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</span></span>}</strong><span className="videoQuizAttemptStatus in_progress">{t(remaining === 0 ? 'qeTimedOut' : 'quizInProgress')}</span></>;
}
