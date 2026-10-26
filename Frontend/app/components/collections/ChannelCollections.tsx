import { Link } from 'react-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useI18n } from '~/i18n';
import { getToken } from '~/functions';
import { CollectionsSVG } from '~/constants';
import InfiniteScroll from '~/components/library/infiniteScroll';
import { nextResultsPage, uniqueResults } from '~/components/library/infiniteResults';
import DefaultThumbnail from '../../../assets/DefaultThumbnail.webp';
import { getCollections } from './api';
import CollectionState from './CollectionState';
import './collections.css';

export default function ChannelCollections({ channelId, sortOrder = 'desc' }: { channelId: string; sortOrder?: 'asc' | 'desc' }) {
  const { t } = useI18n();
  const query = useInfiniteQuery({
    queryKey: ['collections', 'channel', getToken(), channelId, sortOrder],
    enabled: !!channelId,
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => getCollections({ userId: channelId, page: pageParam, limit: 20, sortOrder }, signal),
    getNextPageParam: (page, pages, pageParam) => nextResultsPage(page, pages, pageParam, 20, data => data.collections),
    retry: false,
  });
  const collections = uniqueResults(query.data?.pages.flatMap(page => page.collections) ?? []);
  return <>
    {query.isPending ? <CollectionState /> : query.isError && !query.data ? <CollectionState error={query.error} retry={() => void query.refetch()} /> : <>
      <div className="collection notscrollable channelPlaylistGrid collectionCards">{collections.map(item => <Link key={item.id} to={`/collection/${item.id}`} className="item playlistItem featured">
        <span className="itemThumbnail"><img src={item.thumbnail_url || DefaultThumbnail} alt="" loading="lazy" /><span className="pins absolute bottom-3 right-3 flex items-center"><p className="flex items-center">{CollectionsSVG}&nbsp;{t('collectionLabel')}</p></span></span>
        <h3>{item.title}</h3>{item.subheading && <p className="collectionCardSubtitle">{item.subheading}</p>}
      </Link>)}</div>
      {!collections.length && <p className="collectionState">{t('collectionsEmpty')}</p>}
    </>}
    <InfiniteScroll hasMore={query.hasNextPage} fetching={query.isFetchingNextPage} error={query.isFetchNextPageError}
      onLoadMore={() => void query.fetchNextPage()} loadingLabel={t('videoLoadingData')} />
  </>;
}
