import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getToken } from '~/functions';
import { useI18n } from '~/i18n';
import { Link } from 'react-router';
import InfiniteScroll from '../library/infiniteScroll';
import { uniqueResults } from '../library/infiniteResults';
import { IssuedPreview, issuedDate } from './issuedCertificatePreview';
import { accountCertificatesQuery, accountCertificateQuery } from './accountQueries';
import styles from './accountCertificates.module.css';

function CertificateCard({ item, token }: { item: import('./accountQueries').Certificate; token: string | null | undefined }) {
  const { t, locale } = useI18n();
  const container = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!container.current) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '300px' });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const detail = useQuery({ ...accountCertificateQuery(token, item.id), enabled: !!token && visible, staleTime: 30_000 });
  return <div ref={container} className={styles.card}>
    <div className={styles.preview}>
      {detail.data ? <IssuedPreview certificate={detail.data.certificate} /> : <span className={styles.placeholder}>
        {detail.isError ? t('searchLoadFailed') : <span className="skeleton-thumbnail" />}
      </span>}
    </div>
    <div className="info">
      <h2><Link to={`/certificates/verify/${encodeURIComponent(item.id)}`} className={styles.title} aria-label={`${t('quizViewCertificate')}: ${item.quiz_title || item.certificate_number}`}>{item.quiz_title || t('quizDefaultTitle')}</Link></h2>
      <div className={styles.pills}>
        <span className="views">{item.certificate_number}</span>
        <time className="date" dateTime={item.issued_at}>{issuedDate(item.issued_at, locale)}</time>
        {item.status === 'revoked' && <span className={styles.revoked}>{t('certificateRevoked')}</span>}
      </div>
    </div>
  </div>;
}

export default function AccountCertificates({ onDataStateChange }: { onDataStateChange?: (state: 'loading' | 'empty' | 'has-data') => void }) {
  const { t } = useI18n();
  const token = getToken();
  const list = useInfiniteQuery(accountCertificatesQuery(token));
  const certificates = useMemo(() => uniqueResults(list.data?.pages.flatMap(page => page.certificates) ?? []), [list.data]);
  const loadMore = useCallback(() => {
    if (list.isError && !list.isFetchNextPageError) void list.refetch();
    else void list.fetchNextPage({ cancelRefetch: false });
  }, [list.isError, list.isFetchNextPageError, list.refetch, list.fetchNextPage]);
  useEffect(() => {
    onDataStateChange?.(list.isPending ? 'loading' : certificates.length ? 'has-data' : 'empty');
  }, [list.isPending, certificates.length, onDataStateChange]);

  if (list.isPending) return <div className={styles.grid} aria-busy="true">
    {[0, 1, 2].map(index => <div key={index} className="skeleton-item"><div className="skeleton-thumbnail" /><div className="skeleton-title" /></div>)}
  </div>;
  if (list.isError && !certificates.length) return <div className="platformUsersState" role="alert">
    <p>{t('searchLoadFailed')}</p><button type="button" className="button" onClick={() => void list.refetch()}>{t('usersRetry')}</button>
  </div>;
  if (!certificates.length) return <p className="watchToRecommend">{t('accountCertificatesEmpty')}</p>;

  return <section aria-label={t('accountCertificatesTitle')}>
    <div className={styles.grid}>
      {certificates.map(item => <CertificateCard key={item.id} item={item} token={token} />)}
    </div>
    <InfiniteScroll hasMore={list.hasNextPage} fetching={list.isFetching} error={list.isError} onLoadMore={loadMore} loadingLabel={t('videoLoadingData')} />
  </section>;
}
