import { useContext, useState } from 'react';
import { Link } from 'react-router';
import { CurrentNavContext } from '~/context';
import { CollectionsSVG } from '~/constants';
import { formatDate } from '~/functions';
import { translateContentTitle, useI18n } from '~/i18n';
import type { Collection } from '../collections/model';
import DefaultThumbnail from '../../../assets/DefaultThumbnail.webp';

export default function CollectionItem({ collection }: { collection: Collection }) {
  const { t } = useI18n();
  const { setCurrentNav } = useContext(CurrentNavContext);
  const title = translateContentTitle(collection.title);
  const requestedThumbnail = collection.thumbnail_url || DefaultThumbnail;
  const [failedThumbnail, setFailedThumbnail] = useState<string>();
  const thumbnail = failedThumbnail === requestedThumbnail ? DefaultThumbnail : requestedThumbnail;
  const [loadedThumbnail, setLoadedThumbnail] = useState<string>();
  const loading = loadedThumbnail !== thumbnail;

  return <Link className="item playlistItem featured" to={`/collection/${collection.id}`} onClick={() => setCurrentNav(-1)}>
    <span className="itemThumbnail">
      {loading && <span className="itemThumbnailSkeleton skeleton-thumbnail" aria-hidden="true" />}
      <img src={thumbnail} alt={title} loading="lazy" decoding="async"
        className={`z-0 relative ${loading ? 'opacity-0' : 'opacity-100'}`}
        ref={image => { if (image?.complete && image.naturalWidth > 0) setLoadedThumbnail(thumbnail); }}
        onLoad={() => setLoadedThumbnail(thumbnail)}
        onError={() => { setFailedThumbnail(requestedThumbnail); setLoadedThumbnail(thumbnail); }} />
      <span className="pins absolute bottom-3 right-3 flex items-center">
        <p className="flex items-center gap-1.5">{CollectionsSVG}{t('collectionLabel')}</p>
      </span>
    </span>
    <div className="info">
      <h2 title={title}>{title}</h2>
      <span className="flex flex-wrap gap-1.5">
        {collection.subheading && <p className="views">{collection.subheading}</p>}
        <p className="date">{formatDate(collection.created_at)}</p>
      </span>
    </div>
  </Link>;
}
