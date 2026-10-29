'use client';
import QuizThumbnail from './QuizThumbnail';
import { Link } from 'react-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { decodeHTMLStrict } from 'entities';
import { useAuthorization } from '~/authorization/authorization';
import { P } from '~/authorization/permissions';
import { CheckSVG } from '~/constants';
import { getToken } from '~/functions';
import { useI18n } from '~/i18n';
import { formatDurationWords } from '~/locales/formatDuration';
import InfiniteScroll from '~/components/library/infiniteScroll';
import { nextResultsPage, uniqueResults } from '~/components/library/infiniteResults';
import { engineKey, list } from './api';
import type { PublishedQuiz } from './model';
import styles from './publishedQuizzes.module.css';

export default function PublishedQuizList({ userId, sortOrder = 'desc' }: { userId: string; sortOrder?: 'asc' | 'desc' }) {
  const { t, locale } = useI18n();
  const { user, can } = useAuthorization();
  const token = getToken();
  const allowed = !!token && can(P.quizzesParticipate);
  const query = useInfiniteQuery({
    queryKey: [...engineKey, token, user?.id, 'published', userId, sortOrder],
    enabled: allowed && !!userId,
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => list<PublishedQuiz>('/published', 'quizzes', {
      page: pageParam, limit: 20, sortBy: 'created_at', sortOrder, user_id: userId,
    }, signal),
    getNextPageParam: (page, pages, pageParam) => nextResultsPage(page, pages, pageParam, 20, data => data.items),
    retry: false,
  });
  const quizzes = uniqueResults(query.data?.pages.flatMap(page => page.items) ?? []);
  if (!allowed) return null;
  return <section className={styles.catalog} aria-label={t('navQuizzes')}>
    {query.isPending ? <div className={styles.grid} role="status" aria-label={t('adminLoadingQuizzes')}>
      {Array.from({ length: 3 }, (_, index) => <div key={index} className={`${styles.card} ${styles.skeleton}`} aria-hidden="true"><div className="skeleton-title" /><div className="skeleton-text" /><div className="skeleton-text" /></div>)}
    </div> : query.isError && !query.data ? <div className={styles.state} role="alert">
      <p>{t('adminFailedLoadQuizzes')}</p><button type="button" className={styles.action} onClick={() => void query.refetch()}>{t('usersRetry')}</button>
    </div> : quizzes.length ? <div className={styles.grid}>{quizzes.map(quiz => <article className={styles.card} key={quiz.id}>
      <Link className={styles.cardLink} to={`/quiz/${quiz.id}`} aria-labelledby={`published-quiz-${quiz.id}`}>
        <div className={styles.summary}>
          <QuizThumbnail src={quiz.thumbnail_url} size="cover" />
          <div className={styles.heading}>
          <h3 id={`published-quiz-${quiz.id}`}>{decodeHTMLStrict(quiz.title)}</h3>
          {quiz.description && <p className={styles.description}>{decodeHTMLStrict(quiz.description)}</p>}
          </div>
        </div>
        <dl className={styles.facts}>
          <div><dt>{t('quizQuestions')}</dt><dd>{quiz.question_count}</dd></div>
          <div><dt>{t('quizTimeLimitLabel')}</dt><dd>{quiz.time_limit_seconds ? formatDurationWords(quiz.time_limit_seconds, locale) : t('quizNoTimeLimit')}</dd></div>
          <div><dt>{t('quizPassingScoreLabel')}</dt><dd>{quiz.passing_score_percentage}%</dd></div>
          <div><dt>{t('quizAttemptsLabel')}</dt><dd>{quiz.max_attempts == null ? t('quizUnlimitedLabel') : quiz.max_attempts}</dd></div>
        </dl>
        {quiz.has_certificate && <p className={styles.certificate}><span aria-hidden="true">{CheckSVG}</span>{t('quizCertificateHint')}</p>}
      </Link>
    </article>)}</div> : <p className={styles.empty}>{t('adminNoQuizzesFound')}</p>}
    <InfiniteScroll hasMore={query.hasNextPage} fetching={query.isFetchingNextPage} error={query.isFetchNextPageError}
      onLoadMore={() => void query.fetchNextPage()} loadingLabel={t('adminLoadingQuizzes')} />
  </section>;
}
