import { useEffect, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useAuthorization } from '~/authorization/authorization';
import { P } from '~/authorization/permissions';
import { getToken } from '~/functions';
import { useI18n } from '~/i18n';
import { AddSVG, CheckSVG } from '~/constants';
import InfiniteScroll from '~/components/library/infiniteScroll';
import { nextResultsPage, uniqueResults } from '~/components/library/infiniteResults';
import CustomSelect from '~/components/customSelect/customSelect';
import DefaultThumbnail from '../../../assets/DefaultThumbnail.webp';
import { findCollectionPlaylists } from './api';
import CollectionState from './CollectionState';

export default function PlaylistPicker({ included, busy, onAdd }: { included: string[]; busy: boolean; onAdd: (id: string) => void }) {
  const { t } = useI18n(); const { can } = useAuthorization();
  const allowMine = can(P.playlistsUpdateOwn);
  const [scope, setScope] = useState<'mine' | 'public'>(allowMine ? 'mine' : 'public');
  const [filter, setFilter] = useState(''), [search, setSearch] = useState('');
  const effectiveScope = allowMine ? scope : 'public';
  useEffect(() => { const timer = setTimeout(() => { setSearch(filter.trim()); }, 300); return () => clearTimeout(timer); }, [filter]);
  const query = useInfiniteQuery({ queryKey: ['collection-playlist-picker', 'infinite', getToken(), effectiveScope, search],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => findCollectionPlaylists(effectiveScope, search, pageParam, signal),
    getNextPageParam: (lastPage, pages, page) => nextResultsPage(lastPage, pages, page, 10, result => result.playlists),
    retry: false });
  const playlists = uniqueResults(query.data?.pages.flatMap(page => page.playlists) ?? []);
  return <div className="collectionPicker">
    <div className="collectionPickerSearch formGroup">
      <input type="text" role="searchbox" className="playlistVideoSearchInput" value={filter} onChange={e => setFilter(e.target.value)} aria-label={t('filterPlaylists')} placeholder={t('filterPlaylists')} />
      {allowMine && <CustomSelect value={effectiveScope} onChange={value => { setScope(value as 'mine' | 'public'); }} ariaLabel={t('collectionPlaylistSource')}
        options={[{ value: 'mine', label: t('navMyPlaylists') }, { value: 'public', label: t('collectionPublicPlaylists') }]} />}
    </div>
    {query.isPending ? <CollectionState /> : query.isError && !query.data ? <CollectionState error={query.error} retry={() => void query.refetch()} /> : <>
      <div className="collectionPickerResults">{playlists.map(item => {
        const added = included.includes(item.id);
        return <div key={item.id} className="playlistVideoSearchRow">
          <img className="playlistVideoSearchThumb" src={item.thumbnail_url || DefaultThumbnail} alt="" loading="lazy" />
          <div className="playlistVideoSearchMeta"><strong>{item.title}</strong><small>{t(item.status === 'private' ? 'adminPrivate' : 'adminPublic')}</small></div>
          <button type="button" className="saveCaptionsBtn playlistVideoAddBtn" disabled={busy || added} onClick={() => onAdd(item.id)} aria-label={`${t(added ? 'collectionAdded' : 'collectionAddPlaylist')}: ${item.title}`}>{added ? CheckSVG : AddSVG}</button>
        </div>;
      })}</div>
      {!playlists.length && <p className="formHint">{t('quizNoPlaylistsFound')}</p>}
    </>}
    {query.isRefetchError && query.data && <CollectionState error={query.error} retry={() => void query.refetch()} />}
    {query.data && <InfiniteScroll hasMore={!!query.hasNextPage} fetching={query.isFetching} error={query.isFetchNextPageError}
      onLoadMore={() => { if (!query.isFetching) void query.fetchNextPage(); }} loadingLabel={t('videoLoadingData')} />}
  </div>;
}
