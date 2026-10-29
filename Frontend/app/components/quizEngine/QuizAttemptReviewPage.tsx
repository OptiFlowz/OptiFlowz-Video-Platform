'use client';
import '~/styles/editor.css';
import '~/styles/quiz.css';
import '~/styles/quizExperience.css';
import { useEffect } from 'react';
import QuizThumbnail from './QuizThumbnail';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useI18n } from '~/i18n';
import { LoadState, styles, useAccess, useDetail } from './shared';
import { ManagedAttemptQuestions } from './AttemptPlayer';
import { AttemptFacts, OutcomeLabel, ParticipantAvatar } from './QuizResults';
import { attemptStatusLabels, managedReviewQuestions, type ManagedAttemptDetail } from './quizResultsModel';
import type { Quiz } from './model';
import css from './quizResults.module.css';

export default function QuizAttemptReviewPage() {
  const { quizId = '', attemptId = '' } = useParams(), [params] = useSearchParams(), navigate = useNavigate();
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); }, [quizId, attemptId]);
  const { t, locale } = useI18n(), access = useAccess('quizzes');
  const allowed = access.canAny(['quizzes.attempts.read_own', 'quizzes.attempts.read_any']);
  // The management endpoint checks quiz ownership and the attempt/quiz association.
  const query = useDetail<{ attempt: ManagedAttemptDetail }>(`/${quizId}/results/${attemptId}`, allowed && !!quizId && !!attemptId);
  const detail = useDetail<{ quiz: Quiz }>(`/${quizId}`, allowed && access.read && query.isSuccess);
  const attempt = query.data?.attempt;
  const backUrl = `/quizzes?${new URLSearchParams({ tab: 'quizzes', scope: params.get('scope') === 'all' ? 'all' : 'own', edit: quizId, section: 'results' })}`;
  const date = (value: string | null) => value ? new Date(value).toLocaleString(locale === 'sr' ? 'sr-Latn' : locale, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  if (!allowed) return null;
  return <main className="videoQuizPage quizExperience"><div className="videoQuizPageContent introStage">
    <div className="videoQuizTop"><div className="videoQuizHeaderRow">
      <div className="videoQuizHeading"><QuizThumbnail src={detail.data?.quiz.thumbnail_url} size="heading" /><span><h1>{detail.data?.quiz.title || t('quizDefaultTitle')}</h1><p>{t('quizReviewAttempt')}</p></span></div>
      <div className={`videoQuizTopActions ${styles.page}`}><Link className={styles.button} to={backUrl}>{t('quizResults')}</Link></div>
    </div></div>
    <div className={styles.page}><LoadState query={query} />
      {attempt && !query.isError && <>
        <section className={css.reviewSummary} aria-label={t('quizAttemptNumber', { count: attempt.attempt_no })}>
          <div className={css.reviewSummaryHeader}>
            <div className={css.profileHeader}><ParticipantAvatar user={attempt.user} outcome={attempt.passed} /><div className={css.identityText}><strong className={css.name}>{attempt.user.full_name || attempt.user.id}</strong><span className={css.attemptCount}>{t('quizAttemptNumber', { count: attempt.attempt_no })}</span><OutcomeLabel passed={attempt.passed} /></div></div>
            <span className={styles.badge}>{t(attemptStatusLabels[attempt.status])}</span>
          </div>
          <AttemptFacts attempt={attempt} date={date} />
        </section>
        <ManagedAttemptQuestions key={attempt.id} questions={managedReviewQuestions(attempt)} pageSize={attempt.settings.questions_per_page ?? 1} onClose={() => navigate(backUrl)} />
      </>}
    </div>
  </div></main>;
}
