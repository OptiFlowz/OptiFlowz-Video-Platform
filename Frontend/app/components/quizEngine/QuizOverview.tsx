'use client';
import '~/styles/editor.css';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '~/i18n';
import { getToken } from '~/functions';
import Pagination from '~/components/library/pagination';
import { engineKey, list } from './api';
import { useDetail, useAccess, LoadState, Select, styles } from './shared';
import type { Requirement } from './model';
type Eligibility = { can_start: boolean; can_resume: boolean; reason: string | null; active_attempt_id: string | null; attempts_used: number | null; max_attempts: number | null; attempts_remaining: number | null };
type Attempt = { id: string; attempt_no: number; status: string; started_at: string; expires_at: string | null; finished_at: string | null; max_points: number; earned_points: number | null; score_percentage: number | null; passed: boolean | null };
const statusLabels: Record<string, string> = { in_progress: 'quizInProgress', submitted: 'quizComplete', timed_out: 'qeTimedOut', cancelled: 'qeCancelled' };
export default function QuizOverview() {
  const { quizId = '' } = useParams(), { t, locale } = useI18n(), { user } = useAccess('quizzes');
  const [page, setPage] = useState(1), [limit, setLimit] = useState(20), [status, setStatus] = useState('');
  const token = getToken();
  const eligibility = useDetail<Eligibility>(`/${quizId}/eligibility`, !!quizId);
  const progress = useDetail<{ requirements_met: boolean; requirements: Requirement[] }>(`/quiz-requirements/${quizId}/progress`, !!quizId && eligibility.isSuccess && eligibility.data.reason !== 'quiz_unavailable');
  const attempts = useQuery({ queryKey: [...engineKey, token, user?.id, 'attempts', quizId, page, limit, status], enabled: !!quizId && !!token,
    queryFn: ({ signal }) => list<Attempt>(`/${quizId}/attempts`, 'attempts', { page, limit, ...(status ? { status } : {}), sortOrder: 'desc', sortBy: 'started_at' }, signal), retry: false });
  return <main className={`uploadMain ${styles.page}`}><div className="uploadSide">
    <div className={styles.header}><div><h1>{t('quizDefaultTitle')}</h1><p>{t('quizIntroSubtitle')}</p></div><button type="button" className={styles.button} onClick={() => { void eligibility.refetch(); if (progress.isEnabled) void progress.refetch(); void attempts.refetch(); }}>{t('usersRetry')}</button></div>
    <LoadState query={eligibility} />
    {eligibility.data?.reason === 'quiz_unavailable' ? <p className={styles.note}>{t('quizNoQuizAvailable')}</p> : eligibility.data && <>
      <p className={styles.note}>{t('qeAttemptUnavailable')}</p>
      {eligibility.data.attempts_remaining !== null && <p>{t('quizAttemptsLeft', { count: eligibility.data.attempts_remaining })}</p>}
      {eligibility.data.reason === 'max_attempts_reached' && <p>{t('quizNoAttemptsLeft')}</p>}
      {eligibility.data.can_resume && <p>{t('quizInProgress')}</p>}
      <section className={styles.panel}><h2>{t('quizRequirements')}</h2><LoadState query={progress} />
        {progress.data && <p className={progress.data.requirements_met ? styles.success : styles.muted}>{t(progress.data.requirements_met ? 'quizRequirementComplete' : 'quizCompleteRequiredVideos')}</p>}
        {progress.data?.requirements.map(row => <div key={row.video_id} className={styles.row}>
          {row.video_card && (row.video_card.thumbnail_url || row.video_card.mux_thumbnail_url) && <img className={styles.videoImage} src={row.video_card.thumbnail_url || row.video_card.mux_thumbnail_url || ''} alt="" />}
          <div className={styles.grow}><strong>{row.video_card?.title || t('quizRequiredVideo')}</strong><p>{row.min_watch_percentage !== null ? t('quizRequirementPercentProgress', { watched: row.watched_percentage ?? 0, required: row.min_watch_percentage }) : t('quizRequirementTimeProgress', { watched: row.total_watch_seconds ?? 0, required: row.required_watch_seconds ?? row.min_watch_seconds ?? 0 })}</p>
            {row.completion_percentage !== null && row.completion_percentage !== undefined && <progress className={styles.progress} value={row.completion_percentage} max={100} aria-label={row.video_card?.title || t('quizWatchRequirement')} />}
          </div>{row.is_met ? <span className={styles.badge}>{t('quizRequirementComplete')}</span> : row.video_card && <Link className={styles.button} to={`/video/${row.video_id}`}>{t('quizWatch')}</Link>}
        </div>)}
        {progress.isSuccess && !progress.data.requirements.length && <p>{t('quizNoRequirementVideos')}</p>}
      </section>
    </>}
    <section className={styles.panel}><h2>{t('quizYourLastAttempts')}</h2>
      <Select label={t('adminTableStatus')} value={status} values={[{ value: '', label: t('qeAllStatuses') }, ...Object.entries(statusLabels).map(([value, key]) => ({ value, label: t(key) }))]} onChange={value => { setStatus(value); setPage(1); }} /><LoadState query={attempts} />
      {attempts.data?.items.map(attempt => <div key={attempt.id} className={styles.row}><div className={styles.grow}><strong>{t('quizAttemptNumber', { count: attempt.attempt_no })}</strong><p>{new Date(attempt.started_at).toLocaleString(locale === 'sr' ? 'sr-Latn' : locale)}</p></div><span>{t(statusLabels[attempt.status] ?? 'quizAttempt')}</span>
        {attempt.score_percentage !== null && <span>{attempt.score_percentage}%</span>}{attempt.passed !== null && <span>{t(attempt.passed ? 'quizPassedLabel' : 'quizNotPassedLabel')}</span>}
      </div>)}
      {attempts.isSuccess && !attempts.data.items.length && <p>{t('quizNoAttemptsYet')}</p>}
      <Pagination page={page} limit={limit} total={attempts.data?.pagination.total} totalPages={attempts.data?.pagination.totalPages} loading={attempts.isFetching} label={t('quizYourLastAttempts')} onPageChange={setPage} onLimitChange={value => { setLimit(value); setPage(1); }} />
    </section>
  </div></main>;
}
