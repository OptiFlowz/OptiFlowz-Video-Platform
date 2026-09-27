import { useLocalizedPageTitle } from '~/hooks/useLocalizedPageTitle';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { getToken } from '~/functions';
import { useI18n } from '~/i18n';
import { useAuthorization } from '~/authorization/authorization';
import { P } from '~/authorization/permissions';
import { AddSVG, LiveSVG } from '~/constants';
import Pagination from '../library/pagination';
import CustomSelect from '../customSelect/customSelect';
import Item from '../itemSlider/item';
import { liveRequest, liveStatuses, type LiveList as LiveListResponse } from './api';
import './live.css';

export function useLivestreams({ mine = false, channelId }: { mine?: boolean; channelId?: string }) {
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const token = getToken();
  useEffect(() => { const timer = setTimeout(() => { setQ(search.trim()); setPage(1); }, 300); return () => clearTimeout(timer); }, [search]);
  const query = useQuery({
    queryKey: ['livestreams', token, mine, channelId, q, status, page, limit],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit), ...(q ? { q } : {}), ...(status ? { status } : {}) });
      return liveRequest<LiveListResponse>(`${channelId ? `channels/${channelId}/livestreams` : mine ? 'livestreams/my' : 'livestreams'}?${params}`, 'GET', undefined, signal);
    },
    refetchInterval: 15000, retry: 1,
  });
  return { search, setSearch, status, setStatus, page, setPage, limit, setLimit, query };
}

export function LiveList({ mine = false, channelId }: { mine?: boolean; channelId?: string }) {
  const { t } = useI18n();
  const { can, canOwn } = useAuthorization();
  const { search, setSearch, status, setStatus, page, setPage, limit, setLimit, query } = useLivestreams({ mine, channelId });
  return <section className="liveLibrary" aria-label={t(mine ? 'liveMyStreams' : 'liveTitle')}>
    {!channelId && <div className="liveHeading"><div><h1>{LiveSVG}{t(mine ? 'liveMyStreams' : 'liveTitle')}</h1><p>{t(mine ? 'liveManageIntro' : 'liveBrowseIntro')}</p></div>
      {can(P.liveCreate) && <Link className="liveButton livePrimary" to="/live/new">{AddSVG}{t('liveCreate')}</Link>}
    </div>}
    <div className="liveToolbar">
      <input type="search" maxLength={200} value={search} onChange={e => setSearch(e.target.value)} placeholder={t('liveSearch')} aria-label={t('liveSearch')} />
      <CustomSelect value={status} onChange={v => { setStatus(v); setPage(1); }} ariaLabel={t('liveFilter')} options={[{ value: '', label: t('liveAllStatuses') }, ...liveStatuses.map(value => ({ value, label: t(`liveStatus_${value}`) }))]} />
    </div>
    {query.isPending ? <div className="collection notscrollable">{Array.from({ length: 6 }, (_, i) => <div className="skeleton-item" key={i}><div className="skeleton-thumbnail"/><div className="skeleton-title"/></div>)}</div>
      : query.isError ? <div className="liveEmpty" role="alert"><p>{query.error.message}</p><button className="liveButton" onClick={() => void query.refetch()}>{t('usersRetry')}</button></div>
      : !query.data?.livestreams.length ? <p className="liveEmpty">{t('liveEmpty')}</p>
      : <div className="collection notscrollable">{query.data.livestreams.map(video => <article className="liveCard" key={video.id}>
          <Item props={video} />
          {video.livestream.scheduled_start_at && <p className="liveMeta">{new Date(video.livestream.scheduled_start_at).toLocaleString()}</p>}
          {mine && canOwn(P.liveUpdateOwn, P.liveUpdateAny, video.uploader_id) && <Link className="liveButton" to={`/live/${video.id}/studio`}>{t('liveManage')}</Link>}
        </article>)}</div>}
    {!query.isError && <Pagination page={page} limit={limit} total={query.data?.pagination.total} loading={query.isFetching} label={t('liveTitle')}
      onPageChange={setPage} onLimitChange={v => { setLimit(v); setPage(1); }} />}
  </section>;
}
export default function LivePage({ mine = false }: { mine?: boolean }) { useLocalizedPageTitle(mine ? 'liveMyStreams' : 'liveTitle'); return <main className="livePage"><LiveList mine={mine}/></main>; }
