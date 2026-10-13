import { useEffect, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useAuthorization } from '~/authorization/authorization';
import { P } from '~/authorization/permissions';
import { fetchFn } from '~/API';
import { fetchVectorVideos } from '~/videoDiscovery';
import { getToken } from '~/functions';
import { useI18n } from '~/i18n';
import { AddSVG, CheckSVG } from '~/constants';
import type { PlaylistVideoT } from '~/types';
import { getVideoThumbnail } from '~/components/shared/videoMedia';
import InfiniteScroll from '~/components/library/infiniteScroll';
import { nextResultsPage, uniqueResults } from '~/components/library/infiniteResults';
import CustomSelect from '~/components/customSelect/customSelect';
import styles from './editPlaylistPage.module.css';

type Candidate = PlaylistVideoT & { visibility?: 'public' | 'private' };
type VideoPage = {
  videos: (Pick<Candidate, 'id' | 'title'> & Partial<Candidate>)[];
  total?: number;
  total_pages?: number;
  pagination?: { total?: number; totalPages?: number; limit?: number };
};

export async function findPlaylistVideos(scope: 'mine' | 'public', search: string, page: number, token: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ page: String(page), limit: '10' });
  if (search.trim()) params.set('q', search.trim());
  if (scope === 'mine') { params.set('sort_by', 'created_at'); params.set('sort_dir', 'desc'); }
  const request = { route: `${scope === 'mine' ? 'api/video-moderation/my/videos' : 'api/videos/search'}?${params}`,
    options: { method: 'GET', headers: { Authorization: `Bearer ${token}` }, signal } };
  return scope === 'mine' ? fetchFn<VideoPage>(request) : fetchVectorVideos<VideoPage>(request);
}

export default function PlaylistVideoPicker({ included, busy, addingId, onAdd }: {
  included: string[]; busy: boolean; addingId: string | null; onAdd: (video: PlaylistVideoT) => void;
}) {
  const { t } = useI18n();
  const { can, user } = useAuthorization();
  const allowMine = can(P.videosUpdateOwn);
  const token = getToken();
  const [scope, setScope] = useState<'mine' | 'public'>(allowMine ? 'mine' : 'public');
  const [filter, setFilter] = useState(''), [search, setSearch] = useState('');
  const effectiveScope = allowMine ? scope : 'public';
  useEffect(() => { const timer = setTimeout(() => setSearch(filter.trim()), 300); return () => clearTimeout(timer); }, [filter]);
  const query = useInfiniteQuery({
    queryKey: ['playlist-video-picker', token, effectiveScope, search], enabled: !!token,
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => findPlaylistVideos(effectiveScope, search, pageParam, token!, signal),
    getNextPageParam: (lastPage, pages, page) => nextResultsPage(lastPage, pages, page, 10, result => result.videos),
    retry: false,
  });
  const videos: Candidate[] = uniqueResults(query.data?.pages.flatMap(page => page.videos) ?? []).map(video => ({
    created_at: '', duration_seconds: 0, percentage_watched: 0, progress_seconds: 0, view_count: 0, people: [],
    ...video, uploader_name: video.uploader_name ?? (effectiveScope === 'mine' ? user?.full_name ?? '' : ''),
  }));
  return <>
    <div className={`formGroup ${styles.pickerSearch}`}>
      <input type="text" role="searchbox" className="playlistVideoSearchInput" value={filter} onChange={event => setFilter(event.target.value)} aria-label={t('filterVideos')} placeholder={t('filterVideos')} />
      {allowMine && <CustomSelect value={effectiveScope} onChange={value => setScope(value as 'mine' | 'public')} ariaLabel={t('playlistVideoSource')}
        options={[{ value: 'mine', label: t('navMyVideos') }, { value: 'public', label: t('playlistPublicVideos') }]} />}
    </div>
    {query.isPending ? <p className="formHint" role="status">{t('videoLoadingData')}</p> : query.isError && !query.data ?
      <div role="alert"><p className="formHint">{t('searchLoadFailed')}</p><button type="button" className="saveCaptionsBtn" onClick={() => void query.refetch()}>{t('usersRetry')}</button></div> :
      <div className={styles.pickerResults}>{videos.map(video => {
        const added = included.includes(video.id);
        return <div className={`playlistVideoSearchRow ${styles.pickerRow}`} key={video.id}>
          <img className="playlistVideoSearchThumb" src={getVideoThumbnail(video)} alt="" loading="lazy" />
          <div className={styles.pickerMeta}><strong>{video.title}</strong><small>{t(video.visibility === 'private' ? 'adminPrivate' : 'adminPublic')}{video.uploader_name ? ` · ${video.uploader_name}` : ''}</small></div>
          <button type="button" className="saveCaptionsBtn playlistVideoAddBtn" disabled={busy || added} onClick={() => onAdd(video)} aria-label={`${t(added ? 'playlistVideoAdded' : 'addVideo')}: ${video.title}`}>
            {addingId === video.id ? <span className="uploadSpinner tiny" /> : added ? CheckSVG : AddSVG}
          </button>
        </div>;
      })}{!videos.length && <p className="formHint">{t('playlistSearchEmpty')}</p>}</div>}
    {query.isRefetchError && query.data && <div role="alert"><p className="formHint">{t('searchLoadFailed')}</p><button type="button" className="saveCaptionsBtn" onClick={() => void query.refetch()}>{t('usersRetry')}</button></div>}
    {query.data && <InfiniteScroll hasMore={!!query.hasNextPage} fetching={query.isFetching} error={query.isFetchNextPageError}
      onLoadMore={() => { if (!query.isFetching) void query.fetchNextPage(); }} loadingLabel={t('videoLoadingData')} />}
  </>;
}
