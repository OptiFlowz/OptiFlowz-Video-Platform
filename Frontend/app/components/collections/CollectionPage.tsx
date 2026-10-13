import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { getToken } from '~/functions';
import { useI18n } from '~/i18n';
import PlaylistItem from '~/components/itemSlider/playlistItem';
import ExpandableDescription from '~/components/shared/ExpandableDescription';
import DefaultThumbnail from '../../../assets/DefaultThumbnail.webp';
import { useImagePalette } from '~/hooks/useImagePalette';
import { getCollection } from './api';
import CollectionState from './CollectionState';
import '~/components/playlistPage/playlistPage.css';
import './collections.css';

export default function CollectionPage() {
  const { id } = useParams(); const { t } = useI18n();
  const query = useQuery({ queryKey: ['collections', 'detail', getToken(), id], queryFn: ({ signal }) => getCollection(id!, signal), enabled: !!id, retry: false });
  const thumbnail = query.data?.collection.thumbnail_url || DefaultThumbnail;
  const paletteStyle = useImagePalette(thumbnail);
  if (query.isPending || query.isError) return <main className="playlist playlistDetailsPage collectionDetailsPage"><CollectionState error={query.error} retry={() => void query.refetch()} /></main>;
  const { collection, playlists } = query.data;
  const description = collection.description;
  return <main className="playlist playlistDetailsPage collectionDetailsPage">
    <div className="playlistHero" style={paletteStyle}>
      <img src={thumbnail} alt="" className="plBanner playlistHeroCover" onError={event => {
        if (event.currentTarget.getAttribute('src') !== DefaultThumbnail) event.currentTarget.src = DefaultThumbnail;
      }} />
      <div className="playlistHeroInfo">
        <h1 className="playlistHeroTitle">{collection.title}</h1>
        <p className="playlistHeroStats">
          {collection.subheading && <>{collection.subheading} · </>}
          {t('collectionPlaylistCount', { count: playlists.length })}{collection.visibility === 'private' && <> · {t('adminPrivate')}</>}
        </p>
        {description && <div className="playlistHeroAbout"><ExpandableDescription key={id} text={description} /></div>}
      </div>
    </div>
    <div className="videoHolder" aria-label={t('collectionPlaylistCount', { count: playlists.length })}>
      {playlists.map(playlist => <PlaylistItem key={playlist.id} props={playlist} featured />)}
    </div>
    {!playlists.length && <p className="collectionState">{t('collectionNoPlaylists')}</p>}
  </main>;
}
