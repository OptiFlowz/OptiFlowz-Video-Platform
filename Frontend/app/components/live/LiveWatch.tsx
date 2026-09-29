import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useI18n } from '~/i18n';
import { useAuthorization } from '~/authorization/authorization';
import { P } from '~/authorization/permissions';
import { ShareSVG } from '~/constants';
import { getToken } from '~/functions';
import { useLocalizedPageTitle } from '~/hooks/useLocalizedPageTitle';
import type { VideoT } from '~/types';
import { usePersistentVideo } from '../persistentVideo/persistentVideoProvider';
import VideoInfo from '../playPage/playerCollection/videoInfo';
import CommentsSection from '../playPage/commentsSection';
import { useLiveDetails } from './useLiveStream';
import LivePlaybackView from './LivePlaybackView';
import type { LiveDetails } from './api';
import './live.css';

export default function LiveWatch() {
  useLocalizedPageTitle('liveTitle');
  const { videoId } = useParams();
  const { t } = useI18n();
  const query = useLiveDetails(videoId);
  const { stop } = usePersistentVideo();
  useEffect(() => { stop(); }, [stop, videoId]);
  if (query.isPending) return <main className="liveWatchPage"><p role="status">{t('videoLoadingData')}</p></main>;
  if (!query.data || [401, 403, 404].includes(Number((query.error as { status?: number } | null)?.status))) return <main className="liveWatchPage"><div role="alert"><p>{query.error?.message || t('videoNotFound')}</p><button className="liveButton" onClick={() => void query.refetch()}>{t('usersRetry')}</button></div></main>;
  return <LiveWatchContent key={`${videoId}:${getToken()}`} live={query.data}/>;
}
function LiveWatchContent({ live }: { live: LiveDetails }) {
  const { t } = useI18n();
  const { user, canOwn } = useAuthorization();
  const [notice, setNotice] = useState('');
  const recording = live.current_recording;
  // Video interaction routes still require a ready, visible video; a preparing
  // recording or an unlisted stream does not by itself grant video access.
  const interact = !!recording && recording.mux_status === 'ready' &&
    ((recording.visibility === 'public' && !!recording.published_at && Date.parse(recording.published_at) <= Date.now()) ||
      (['public', 'private'].includes(recording.visibility) && user?.id === live.uploader_id));
  const video: VideoT | undefined = interact && recording ? {
    ...recording, title: live.title, description: live.description || '', visibility: recording.visibility as VideoT['visibility'],
    duration_seconds: recording.duration_seconds ?? 0, published_at: recording.published_at || '',
    progress_seconds: recording.progress_seconds ?? 0, percentage_watched: recording.percentage_watched ?? 0,
    uploader_id: live.uploader_id, uploader_name: live.uploader_name, uploader_image: live.uploader_image || '',
    categories: [], chapters: [], tags: [], people: [], playlists: [], view: null,
  } : undefined;
  return <main className="liveWatchPage liveWatch">
    <div className="livePlayer"><LivePlaybackView live={live}/></div>
    <div className="liveWatchDetails">
      {video ? <VideoInfo key={video.id} props={video} live onOpenChapter={() => {}} onOpenTranscript={() => {}}/> : <>
        <h1>{live.title}</h1><p className="liveDescription">{live.description}</p>
      </>}
      <div className="liveActions">
        <Link className="liveButton" to={`/channel/${live.uploader_id}/live`}>{live.uploader_name} · {t('liveTitle')}</Link>
        {(canOwn(P.liveUpdateOwn, P.liveUpdateAny, live.uploader_id) || canOwn(P.liveBroadcastOwn, P.liveBroadcastAny, live.uploader_id) || canOwn(P.liveDeleteOwn, P.liveDeleteAny, live.uploader_id)) && <Link className="liveButton" to={`/live/${live.id}/studio`}>{t('liveManage')}</Link>}
        {!video && <button className="liveButton" onClick={() => { void navigator.clipboard.writeText(`${window.location.origin}/live/${live.id}`).then(() => setNotice(t('liveCopied'))).catch(() => setNotice(t('liveOperationFailed'))); }}>{ShareSVG}{t('share')}</button>}
      </div>
      {notice && <p role="status">{notice}</p>}
    </div>
    {video && <CommentsSection key={video.id} videoId={video.id} refreshInterval={15000}/>}
  </main>;
}
