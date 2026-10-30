import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { AnalyticsSVG, CheckSVG, CloseSVG, DeleteSVG, UserSVG } from '~/constants';
import { getToken } from '~/functions';
import { useI18n } from '~/i18n';
import { ConfirmDialog } from '~/components/confirmPopup/confirmDialog';
import { useConfirm } from '~/components/confirmPopup/useConfirm';
import { deleteQuizAttempt, resetQuizAttempts } from './quizResultsApi';
import Pagination from '~/components/library/pagination';
import { engineKey, list } from './api';
import { LoadState, Notice, Select, useAccess, useAction, styles } from './shared';
import EditorPopup from './EditorPopup';
import type { Quiz } from './model';
import { attemptStatusLabels, canReadQuizResults, participantOutcome, type ManagedAttempt, type ParticipantResults, type ResultUser } from './quizResultsModel';
import css from './quizResults.module.css';

export default function QuizResults({ quiz }: { quiz: Quiz }) {
  const access = useAccess('quizzes', quiz);
  if (!canReadQuizResults(access, quiz.user_id)) return null;
  return <ResultsList key={quiz.id} quiz={quiz} />;
}

function ResultsList({ quiz }: { quiz: Quiz }) {
  const { t, locale } = useI18n(), access = useAccess('quizzes', quiz), token = getToken();
  const action = useAction(), { confirm, dialogProps } = useConfirm();
  const [progress, setProgress] = useState<{ deleted: number; total: number } | null>(null);
  const canReset = access.canOwn('quizzes.attempts.delete_own', 'quizzes.attempts.delete_any', quiz.user_id);
  const [page, setPage] = useState(1), [limit, setLimit] = useState(20);
  const [status, setStatus] = useState(''), [passed, setPassed] = useState('');
  const [sort, setSort] = useState('started_at'), [order, setOrder] = useState('desc');
  const [participant, setParticipant] = useState<ParticipantResults | null>(null);
  const [searchParams] = useSearchParams();
  const scope = searchParams.get('scope') === 'all' ? 'all' : 'own';
  const params = { page, limit, status, passed, sortBy: sort, sortOrder: order };
  const query = useQuery({ queryKey: [...engineKey, token, access.user?.id, quiz.id, 'results-by-user', params], enabled: !!token,
    queryFn: ({ signal }) => list<ParticipantResults>(`/${quiz.id}/results/by-user`, 'users', params, signal), retry: false });
  const reset = async () => {
    if (!canReset || action.busy) return;
    if (!await confirm({ title: t('quizResetAttempts'), message: t('quizResetAttemptsConfirm'), yesText: t('adminDeleteAll'), noText: t('adminCancel') })) return;
    setProgress(null);
    setParticipant(null);
    await action.run(async () => {
      await resetQuizAttempts(quiz.id, (deleted, total) => setProgress({ deleted, total }));
      setPage(1); setStatus(''); setPassed(''); setProgress(null);
    });
  };
  const removeAttempt = async (attempt: ManagedAttempt) => {
    if (!canReset || action.busy) return;
    if (!await confirm({ title: `${t('adminDelete')} — ${t('quizAttemptNumber', { count: attempt.attempt_no })}`, message: t('adminConfirmMessage'), yesText: t('adminDelete'), noText: t('adminCancel') })) return;
    await action.run(async () => {
      await deleteQuizAttempt(quiz.id, attempt.id);
      setParticipant(current => {
        if (!current) return null;
        const attempts = current.attempts.filter(item => item.id !== attempt.id);
        return attempts.length ? { ...current, attempts } : null;
      });
      if (participant?.attempts.length === 1 && query.data?.items.length === 1) setPage(current => Math.max(1, current - 1));
    });
  };
  const date = (value: string | null) => value ? new Date(value).toLocaleString(locale === 'sr' ? 'sr-Latn' : locale, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  return <section className={css.results} aria-label={t('quizResults')}>
    {!participant && <Notice {...action} />}
    {progress && <p role="status" className={css.attemptCount}>{t('quizResetAttemptsProgress', { deleted: progress.deleted, total: progress.total })}</p>}
    <div className={css.filters}>
      <Select label={t('adminTableStatus')} value={status} values={[{ value: '', label: t('qeAllStatuses') }, ...Object.entries(attemptStatusLabels).map(([value, label]) => ({ value, label: t(label) }))]} onChange={value => { setStatus(value); setPage(1); }} />
      <Select label={t('quizResults')} value={passed} values={[{ value: '', label: t('quizAllResults') }, { value: 'true', label: t('quizPassedLabel') }, { value: 'false', label: t('quizNotPassedLabel') }]} onChange={value => { setPassed(value); setPage(1); }} />
      <Select label={t('usersSortBy')} value={sort} values={[
        { value: 'started_at', label: t('quizStartedAt') }, { value: 'finished_at', label: t('quizFinishedAt') },
        { value: 'attempt_no', label: t('quizAttempt') }, { value: 'status', label: t('adminTableStatus') },
        { value: 'earned_points', label: t('quizPoints') }, { value: 'score_percentage', label: t('quizResultScore') },
      ]} onChange={value => { setSort(value); setPage(1); }} />
      <Select label={t('usersSortOrder')} value={order} values={[{ value: 'desc', label: t('qeDescending') }, { value: 'asc', label: t('qeAscending') }]} onChange={value => { setOrder(value); setPage(1); }} />
    </div>
    <LoadState query={query} />
    {query.data && !query.isError && (query.data.items.length ? <div className={css.participants} aria-busy={query.isFetching}>
      {query.data.items.map(group => <button type="button" className={css.participant} key={group.user.id} aria-haspopup="dialog" disabled={action.busy} onClick={() => { setParticipant(group); }}>
        <ParticipantSummary group={group} quizId={quiz.id} filtered={!!(status || passed)} />
      </button>)}
    </div> : <p className={styles.partEmpty}>{t(status || passed ? 'noResultsTitle' : 'quizNoAttemptsYet')}</p>)}
    {canReset && <div className={css.resetActions}>
      <button type="button" className={`${styles.button} ${styles.danger}`} disabled={action.busy || query.isPending || query.isError} onClick={() => void reset()}>{DeleteSVG}{t('quizResetAttempts')}</button>
    </div>}
    {!!query.data?.pagination.total && <Pagination page={page} limit={limit} total={query.isError ? undefined : query.data.pagination.total} totalPages={query.data.pagination.totalPages} loading={query.isFetching} label={t('quizParticipants')} onPageChange={setPage} onLimitChange={value => { setLimit(value); setPage(1); }} />}
    <EditorPopup wide className={css.resultsPopup} heading={participant && <ParticipantSummary group={participant} quizId={quiz.id} filtered={!!(status || passed)} header />} open={!!participant} title={t('quizAttemptsLabel')} onClose={() => { if (!action.busy) setParticipant(null); }}>
      {participant && <div className={css.participantPopup} aria-busy={action.busy}>
        {action.error && !action.busy && <p className={styles.error} role="alert">{action.error}</p>}
        <div className={css.attempts}>
        {participant.attempts.map(attempt => <AttemptCard key={attempt.id} attempt={attempt} date={date} busy={action.busy} onDelete={canReset ? () => void removeAttempt(attempt) : undefined} reviewUrl={`/quiz/${encodeURIComponent(quiz.id)}/results/${encodeURIComponent(attempt.id)}?scope=${scope}`} />)}
      </div></div>}
    </EditorPopup>
    <ConfirmDialog {...dialogProps} />
  </section>;
}

function ParticipantSummary({ group, quizId, filtered, header = false }: { group: ParticipantResults; quizId: string; filtered: boolean; header?: boolean }) {
  const { t, locale } = useI18n(), token = getToken();
  // Filters omit attempts before grouping; use the full history for the participant's outcome.
  const history = useQuery({ queryKey: [...engineKey, token, quizId, 'participant-outcome', group.user.id], enabled: !!token && filtered,
    queryFn: ({ signal }) => list<ParticipantResults>(`/${quizId}/results/by-user`, 'users', { user_id: group.user.id, page: 1, limit: 1 }, signal), retry: false });
  const outcome = filtered ? participantOutcome(history.data?.items[0]?.attempts ?? []) : participantOutcome(group.attempts);
  return <span className={header ? css.profileHeader : css.profileCard}>
    <ParticipantAvatar user={group.user} outcome={outcome} />
    <span className={css.identityText}>
      <strong className={css.name}>{group.user.full_name || group.user.id}</strong>
      <span className={css.attemptCount}>{t('quizAttemptsLabel')}: {group.attempts.length.toLocaleString(locale)}</span>
      <OutcomeLabel passed={outcome} />
    </span>
  </span>;
}

export function ParticipantAvatar({ user, outcome }: { user: ResultUser; outcome: boolean | null }) {
  return <span className={css.avatar} data-outcome={outcome == null ? undefined : outcome ? 'passed' : 'failed'} aria-hidden="true">{user.image_url && <img key={user.image_url} src={user.image_url} alt="" loading="lazy" onError={event => { event.currentTarget.style.display = 'none'; }} />}{UserSVG}</span>;
}

export function OutcomeLabel({ passed }: { passed: boolean | null }) {
  const { t } = useI18n();
  return <span className={css.outcome} data-outcome={passed == null ? undefined : passed ? 'passed' : 'failed'}>
    {passed == null ? null : passed ? CheckSVG : CloseSVG}{t(passed == null ? 'quizNotChecked' : passed ? 'quizPassedLabel' : 'quizNotPassedLabel')}
  </span>;
}

function AttemptCard({ attempt, date, reviewUrl, busy, onDelete }: { attempt: ManagedAttempt; date: (value: string | null) => string; reviewUrl: string; busy: boolean; onDelete?: () => void }) {
  const { t, locale } = useI18n();
  const number = (value: number | null) => value == null ? '—' : value.toLocaleString(locale, { maximumFractionDigits: 2 });
  return <article className={css.attempt}>
    <div className={css.attemptTop}>
      <div className={css.attemptTitle}><h3>{t('quizAttemptNumber', { count: attempt.attempt_no })}</h3><span className={css.attemptCount}>{t(attemptStatusLabels[attempt.status])}</span></div>
      <OutcomeLabel passed={attempt.passed} />
    </div>
    <div className={css.scoreRow}>
      <div className={css.score} data-outcome={attempt.passed == null ? undefined : attempt.passed ? 'passed' : 'failed'}><span>{t('quizResultScore')}</span><strong>{attempt.score_percentage == null ? '—' : `${number(attempt.score_percentage)}%`}</strong></div>
      <div className={css.points}><span>{t('quizPoints')}</span><strong>{number(attempt.earned_points)} / {number(attempt.max_points)}</strong></div>
    </div>
    <div className={css.attemptFooter}>
      <dl className={css.dates}><div><dt>{t('quizStartedAt')}</dt><dd>{date(attempt.started_at)}</dd></div><div><dt>{t('quizFinishedAt')}</dt><dd>{date(attempt.finished_at)}</dd></div></dl>
      <div className={css.attemptActions}>
        <Link className={styles.button} to={reviewUrl}>{AnalyticsSVG}{t('quizReviewAttempt')}</Link>
        {onDelete && <button type="button" className={`${styles.icon} ${styles.danger}`} aria-label={`${t('adminDelete')} — ${t('quizAttemptNumber', { count: attempt.attempt_no })}`} title={t('adminDelete')} disabled={busy} onClick={onDelete}>{DeleteSVG}</button>}
      </div>
    </div>
  </article>;
}

export function AttemptFacts({ attempt, date }: { attempt: ManagedAttempt; date: (value: string | null) => string }) {
  const { t, locale } = useI18n();
  const number = (value: number | null) => value == null ? '—' : value.toLocaleString(locale, { maximumFractionDigits: 2 });
  return <dl className={css.facts}>
    <div><dt>{t('quizStartedAt')}</dt><dd>{date(attempt.started_at)}</dd></div>
    <div><dt>{t('quizFinishedAt')}</dt><dd>{date(attempt.finished_at)}</dd></div>
    <div><dt>{t('quizPoints')}</dt><dd>{number(attempt.earned_points)} / {number(attempt.max_points)}</dd></div>
    <div><dt>{t('quizResultScore')}</dt><dd>{attempt.score_percentage == null ? '—' : `${number(attempt.score_percentage)}%`}</dd></div>
    <div><dt>{t('quizResults')}</dt><dd className={attempt.passed === true ? styles.success : attempt.passed === false ? styles.error : undefined}>{attempt.passed == null ? '—' : t(attempt.passed ? 'quizPassedLabel' : 'quizNotPassedLabel')}</dd></div>
  </dl>;
}

