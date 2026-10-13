import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '~/i18n';
import { getToken } from '~/functions';
import { CollectionsSVG } from '~/constants';
import Pagination from '~/components/library/pagination';
import DefaultThumbnail from '../../../assets/DefaultThumbnail.webp';
import { getCollections } from './api';
import CollectionState from './CollectionState';
import './collections.css';

export default function ChannelCollections({ channelId }: { channelId: string }) {
  const { t } = useI18n(); const [page, setPage] = useState(1), [limit, setLimit] = useState(20);
  const query = useQuery({ queryKey: ['collections', 'channel', getToken(), channelId, page, limit],
    queryFn: ({ signal }) => getCollections({ userId: channelId, page, limit }, signal), retry: false });
  return <>
    {query.isPending ? <CollectionState /> : query.isError ? <CollectionState error={query.error} retry={() => void query.refetch()} /> : <>
      <div className="collection notscrollable channelPlaylistGrid collectionCards">{query.data.collections.map(item => <Link key={item.id} to={`/collection/${item.id}`} className="item playlistItem featured">
        <span className="itemThumbnail"><img src={item.thumbnail_url || DefaultThumbnail} alt="" loading="lazy" /><span className="collectionCardLabel">{CollectionsSVG}{t('collectionLabel')}</span></span>
        <h3>{item.title}</h3>{item.subheading && <p className="collectionCardSubtitle">{item.subheading}</p>}
      </Link>)}</div>
      {!query.data.collections.length && <p className="collectionState">{t('collectionsEmpty')}</p>}
    </>}
    <Pagination page={page} limit={limit} total={query.data?.pagination.total} totalPages={query.data?.pagination.totalPages} loading={query.isFetching} disabled={query.isError} label={t('collectionsTab')} onPageChange={setPage} onLimitChange={n => { setLimit(n); setPage(1); }} />
  </>;
}
