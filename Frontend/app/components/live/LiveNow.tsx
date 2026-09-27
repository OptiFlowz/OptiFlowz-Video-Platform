import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useAuthorization } from '~/authorization/authorization';
import { P } from '~/authorization/permissions';
import { useI18n } from '~/i18n';
import { getToken } from '~/functions';
import Item from '../itemSlider/item';
import { liveRequest, type LiveList } from './api';
import './live.css';
export default function LiveNow() {
  const { can } = useAuthorization();
  const { t } = useI18n();
  const query = useQuery({ queryKey: ['livestreams', 'home', getToken()], enabled: can(P.liveLibrary),
    queryFn: ({ signal }) => liveRequest<LiveList>('livestreams?status=live&limit=3', 'GET', undefined, signal), refetchInterval: 30000, retry: 1 });
  if (!can(P.liveLibrary) || query.isError || !query.data?.livestreams.length) return null;
  return <section className="liveNow"><div className="collection-header"><h2>{t('liveNow')}</h2><Link to="/live">{t('viewAll')}</Link></div>
    <div className="collection notscrollable">{query.data.livestreams.map(video => <Item key={video.id} props={video}/>)}</div></section>;
}
