import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { useI18n } from '~/i18n';
import { useAuthorization } from '~/authorization/authorization';
import { P } from '~/authorization/permissions';
import { getToken } from '~/functions';
import { useLocalizedPageTitle } from '~/hooks/useLocalizedPageTitle';
import type { SimilarT, VideoT } from '~/types';
import { fetchVectorVideos } from '~/videoDiscovery';
import { usePersistentVideo } from '../persistentVideo/persistentVideoProvider';
import VideoInfo from '../playPage/playerCollection/videoInfo';
import CommentsSection from '../playPage/commentsSection';
import Similar from '../playPage/playerCollection/similar';
import InPlaylist from '../playPage/inPlaylist';
import LiveStatus from './LiveStatus';
import { useLiveDetails } from './useLiveStream';
import LivePlaybackView from './LivePlaybackView';
import { liveRequest, type LiveDetails } from './api';
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
  const token = getToken();
  const recording = live.current_recording;
  // Live details has already authorized this stream. Mux keeps its current
  // recording in "preparing" until the broadcast finishes; it is still the
  // video ID used by reactions, comments and recommendations during the live.
  const activeRecording = ['live', 'disconnected'].includes(live.status) &&
    recording?.mux_status !== 'deleted' && !recording?.recording_completed_at;
  const recordingId = activeRecording ? recording?.id || live.video_id || undefined : undefined;
  const hasRecording = !!recordingId;
  const readyVideo = !!recording && recording.mux_status === 'ready' &&
    ((recording.visibility === 'public' && !!recording.published_at && Date.parse(recording.published_at) <= Date.now()) ||
      (['public', 'private'].includes(recording.visibility) && user?.id === live.uploader_id));
  const details = useQuery({
    queryKey: ['live-recording-details', recordingId, token],
    enabled: hasRecording && readyVideo && !!token,
    queryFn: ({ signal }) => liveRequest<VideoT>(`videos/${recordingId}`, 'GET', undefined, signal),
    staleTime: 30000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: false,
  });
  const similar = useQuery({
    queryKey: ['live-similar-videos', recordingId, token, live.title, live.description],
    enabled: hasRecording && !!token,
    queryFn: async ({ signal }) => {
      const options = { signal, headers: { Authorization: `Bearer ${token}` } };
      const related = await fetchVectorVideos<SimilarT>({ route: `api/videos/${recordingId}/similar`, options });
      if (related.videos.length) return related;
      // An in-progress recording may not have tags or an embedding yet.
      // Use the event's text to find related published videos in that case.
      const query = [live.title, live.description].filter(Boolean).join(' ').slice(0, 500).trim();
      if (!query) return related;
      const results = await fetchVectorVideos<SimilarT>({
        route: `api/videos/search?${new URLSearchParams({ q: query, limit: '10', page: '1' })}`, options,
      });
      return { ...results, videos: results.videos.filter(video => video.id !== recordingId) };
    },
    staleTime: 4 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  // The defaults are only for VideoInfo's presentation contract. Metadata-only
  // mode hides video statistics and controls when the backend has no video.
  const video: VideoT = {
    created_at: live.created_at, updated_at: live.updated_at,
    like_count: 0, dislike_count: 0, view_count: 0, user_reaction: 0,
    categories: [], chapters: [], tags: [], people: [], playlists: [],
    ...(hasRecording && readyVideo ? details.data : undefined),
    ...(hasRecording ? recording : undefined),
    id: recordingId || '',
    title: live.title, description: live.description || '', view: null,
    visibility: recording?.visibility === 'private' ? 'private' : 'public',
    duration_seconds: recording?.duration_seconds ?? 0, published_at: recording?.published_at || '',
    progress_seconds: recording?.progress_seconds ?? 0, percentage_watched: recording?.percentage_watched ?? 0,
    uploader_id: live.uploader_id, uploader_name: live.uploader_name, uploader_image: live.uploader_image || '',
  };
  const canManage = canOwn(P.liveUpdateOwn, P.liveUpdateAny, live.uploader_id) ||
    canOwn(P.liveBroadcastOwn, P.liveBroadcastAny, live.uploader_id) ||
    canOwn(P.liveDeleteOwn, P.liveDeleteAny, live.uploader_id);
  return <main className={`play liveWatchPage liveWatch ${hasRecording ? '' : 'liveWatch--detailsOnly'}`}>
    <div className="liveWatchPrimary">
      <div className="livePlayer"><LivePlaybackView live={live}/></div>
      <div className="liveWatchDetails">
        <VideoInfo key={video.id || live.id} props={video} live metadataOnly={!hasRecording}
          titlePrefix={<LiveStatus live={live} scheduledAt={live.scheduled_at}/>} metadata={false}
          onOpenChapter={() => {}} onOpenTranscript={() => {}}/>
        {canManage && <div className="liveActions">
          <Link className="liveButton" to={`/live/${live.id}/studio`}>{t('liveManage')}</Link>
        </div>}
      </div>
      {hasRecording && <>
        {!!video.playlists?.length && <InPlaylist props={video.playlists}/>}
        <div className="liveWatchComments"><CommentsSection key={recordingId} videoId={recordingId!} refreshInterval={15000}/></div>
      </>}
    </div>
    {hasRecording && <div className="relevant flex flex-col gap-7">
      {similar.isError ? <div className="liveError" role="alert">
        <p>{similar.error.message}</p>
        <button className="liveButton" onClick={() => void similar.refetch()}>{t('usersRetry')}</button>
      </div> : <Similar props={similar.data} isLoading={similar.isLoading}/>}
    </div>}
  </main>;
}
