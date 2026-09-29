import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { getToken } from '~/functions';
import { useI18n } from '~/i18n';
import { useAuthorization } from '~/authorization/authorization';
import Pagination from '../library/pagination';
import CustomSelect from '../customSelect/customSelect';
import Item from '../itemSlider/item';
import { liveRequest, type LiveCardsResponse, type LiveListResponse } from './api';
import './live.css';

export function useLivestreams() {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [sort, setSort] = useState('created_at:desc');
  const [search, setSearch] = useState('');
  const term = search.trim().toLocaleLowerCase();
  const filtering = !!term;
  const token = getToken();
  const query = useQuery({
    queryKey: ['livestreams', token, filtering ? 'filter' : 'page', filtering ? 1 : page, filtering ? 100 : limit, sort], enabled: !!token,
    queryFn: async ({ signal }) => {
      const [sort_by, sort_dir] = sort.split(':');
      const params = new URLSearchParams({ page: String(filtering ? 1 : page), limit: String(filtering ? 100 : limit), sort_by, sort_dir });
      const first = await liveRequest<LiveListResponse>(`live-streams/my/lives?${params}`, 'GET', undefined, signal);
      if (!filtering) return first;
      // The API has no search parameter; fetch every page before filtering locally.
      const streams = new Map(first.live_streams.map(stream => [stream.id, stream]));
      for (let nextPage = 2; nextPage <= first.total_pages; nextPage += 1) {
        params.set('page', String(nextPage));
        const next = await liveRequest<LiveListResponse>(`live-streams/my/lives?${params}`, 'GET', undefined, signal);
        next.live_streams.forEach(stream => streams.set(stream.id, stream));
      }
      return { ...first, live_streams: Array.from(streams.values()) };
    },
    staleTime: 0, gcTime: 0, refetchInterval: 15000, retry: 1,
  });
  const data = useMemo(() => {
    if (!filtering || !query.data) return query.data;
    const matches = query.data.live_streams.filter(stream =>
      `${stream.title} ${stream.description || ''}`.toLocaleLowerCase().includes(term));
    const total_pages = Math.max(1, Math.ceil(matches.length / limit));
    const currentPage = Math.min(page, total_pages);
    return { ...query.data, page: currentPage, limit, total: matches.length, total_pages,
      live_streams: matches.slice((currentPage - 1) * limit, currentPage * limit) };
  }, [query.data, filtering, term, page, limit]);
  useEffect(() => {
    if (filtering && data && page !== data.page) setPage(data.page);
  }, [filtering, data, page]);
  return { page, setPage, limit, setLimit, sort, setSort, search, setSearch, query: { ...query, data } };
}

export function LiveList({ channelId }: { channelId: string }) {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [sort, setSort] = useState('streamed_at:desc');
  const token = getToken();
  const query = useQuery({
    queryKey: ['live-cards', channelId, token, page, limit, sort], enabled: !!channelId,
    queryFn: ({ signal }) => {
      const [sort_by, sort_dir] = sort.split(':');
      const params = new URLSearchParams({ page: String(page), limit: String(limit), sort_by, sort_dir });
      return liveRequest<LiveCardsResponse>(`live-streams/users/${encodeURIComponent(channelId)}/cards?${params}`, 'GET', undefined, signal);
    },
    staleTime: 0, gcTime: 0, refetchInterval: 15000, retry: 1,
  });
  return <section className="liveLibrary" aria-label={t('liveTitle')}>
    <div className="liveToolbar"><CustomSelect value={sort} onChange={value => { setSort(value); setPage(1); }} ariaLabel={t('searchSortBy')} options={[
      { value: 'streamed_at:desc', label: t('channelSortNewest') }, { value: 'streamed_at:asc', label: t('channelSortOldest') }, { value: 'views:desc', label: t('searchSortViews') },
    ]}/></div>
    {query.isPending ? <div className="collection notscrollable">{Array.from({ length: 6 }, (_, i) => <div className="skeleton-item" key={i}><div className="skeleton-thumbnail"/><div className="skeleton-title"/></div>)}</div>
      : query.isError ? <div className="liveEmpty" role="alert"><p>{query.error.message}</p><button className="liveButton" onClick={() => void query.refetch()}>{t('usersRetry')}</button></div>
      : !query.data?.cards.length ? <p className="liveEmpty">{t('liveEmpty')}</p>
      : <div className="collection notscrollable">{query.data.cards.map(card => <article className="liveCard" key={`${card.card_type}:${card.id}`}>
        <Item href={card.card_type === 'recording' ? `/video/${card.video_id}` : `/live/${card.livestream_id}`}
          live={card.card_type === 'recording' ? undefined : { status: card.livestream_status }}
          props={{ ...card, duration_seconds: card.duration_seconds ?? 0, progress_seconds: card.progress_seconds ?? 0, percentage_watched: card.percentage_watched ?? 0 }}/>
        {card.card_type === 'scheduled' && card.scheduled_at && <p className="liveMeta">{new Date(card.scheduled_at).toLocaleString()}</p>}
      </article>)}</div>}
    {!query.isError && <Pagination page={page} limit={limit} total={query.data?.total} loading={query.isFetching} label={t('liveTitle')}
      onPageChange={setPage} onLimitChange={value => { setLimit(value); setPage(1); }} />}
  </section>;
}
// The new API exposes channel cards, not a global livestream directory.
export default function LivePage() {
  const { user, loading } = useAuthorization();
  const navigate = useNavigate();
  useEffect(() => { if (!loading) navigate(user?.id ? `/channel/${user.id}/live` : '/', { replace: true }); }, [loading, user?.id, navigate]);
  return null;
}
