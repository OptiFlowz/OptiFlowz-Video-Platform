import MuxPlayer from '@mux/mux-player-react';
import type MuxPlayerElement from '@mux/mux-player';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LiveSVG } from '~/constants';
import { useI18n } from '~/i18n';
import { fetchApiResponse } from '~/API';
import { getToken } from '~/functions';
import { env } from '~/env';
import type { SimilarT, VideoT } from '~/types';
import { useVideoPlayback, type VideoPlayback } from '../playback/useVideoPlayback';
import { getVideoThumbnail } from '../shared/videoMedia';
import { usePersistentVideo } from '../persistentVideo/persistentVideoProvider';
import VideoInfo from '../playPage/playerCollection/videoInfo';
import Similar from '../playPage/playerCollection/similar';
import CommentsSection from '../playPage/commentsSection';
import LiveStatus from './LiveStatus';
import './live.css';

export default function LiveWatch({ video, similar, loadingSimilar }: { video: VideoT; similar?: SimilarT; loadingSimilar: boolean }) {
  const { t } = useI18n();
  const { stop } = usePersistentVideo();
  const client = useQueryClient();
  const player = useRef<MuxPlayerElement | null>(null);
  const [failed, setFailed] = useState(false);
  const available = video.playback_available === true;
  const playback = useVideoPlayback(video.id, available);
  const [source, setSource] = useState<VideoPlayback>();
  const resume = useRef<{ time: number; paused: boolean } | null>(null);
  useEffect(() => {
    const next = playback.data;
    if (!next || next.stream_url === source?.stream_url) return;
    if (source?.mux_playback_id === next.mux_playback_id && player.current && next.stream_type === 'live:dvr') {
      resume.current = { time: player.current.currentTime, paused: player.current.paused };
    } else resume.current = null;
    setSource(next);
  }, [playback.data, source]);
  const session = useRef({ viewId: '', seq: 0 });
  const playing = useRef(false);
  const live = video.livestream!;
  useEffect(() => { stop(); }, [stop, video.id]);
  useEffect(() => {
    setFailed(false);
    void client.invalidateQueries({ queryKey: ['video-playback', video.id] });
  }, [video.id, video.stream_type, live.status, client]);
  useEffect(() => { setFailed(false); }, [playback.data?.stream_url]);
  useEffect(() => {
    const nextId = video.view?.view_id || '';
    session.current = { viewId: nextId, seq: nextId === session.current.viewId ? Math.max(session.current.seq, video.view?.last_seq ?? 0) : video.view?.last_seq ?? 0 };
  }, [video.view]);
  const heartbeat = (isPlaying: boolean) => {
    const current = session.current;
    if (!current.viewId) return;
    const token = getToken();
    void fetchApiResponse(`${env.apiBaseUrl}/api/videos/heartbeat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ view_id: current.viewId, seq: ++current.seq, is_playing: isPlaying }), keepalive: true,
    }).catch(() => {});
  };
  useEffect(() => {
    const timer = setInterval(() => heartbeat(playing.current && !player.current?.paused), 10000);
    const onLeave = () => heartbeat(false);
    window.addEventListener('pagehide', onLeave);
    return () => { clearInterval(timer); window.removeEventListener('pagehide', onLeave); heartbeat(false); };
  }, [video.id]);
  useEffect(() => { if (!available) { playing.current = false; heartbeat(false); } }, [available]);
  return <main className="play liveWatch px-0 py-7.5">
    <div className="flex flex-col gap-5 overflow-x-hidden">
      <div className="livePlayer">
        {available && playback.data && source && !failed ? <MuxPlayer
          ref={player} key={source.mux_playback_id} src={source.stream_url}
          streamType="live" targetLiveWindow={source.stream_type === 'live:dvr' ? Infinity : 0}
          autoPlay="muted" playsInline accentColor="var(--accentBlue3)" poster={getVideoThumbnail(video) || undefined}
          metadata={{ video_id: video.id, video_title: video.title }}
          onLoadedMetadata={() => {
            const saved = resume.current;
            const element = player.current;
            if (!saved || !element) return;
            resume.current = null;
            if (Number.isFinite(saved.time) && element.seekable.length) {
              element.currentTime = Math.min(element.seekable.end(element.seekable.length - 1), Math.max(element.seekable.start(0), saved.time));
            }
            if (saved.paused) element.pause(); else void element.play().catch(() => {});
          }}
          onPlaying={() => { playing.current = true; heartbeat(true); }}
          onPause={() => { playing.current = false; heartbeat(false); }}
          onWaiting={() => { playing.current = false; heartbeat(false); }}
          onEnded={() => { playing.current = false; heartbeat(false); void client.invalidateQueries({ queryKey: ['video', video.id] }); }}
          onError={() => { playing.current = false; heartbeat(false); setFailed(true); }}
        /> : <div className="liveWaiting" role="status">
          {getVideoThumbnail(video) ? <img src={getVideoThumbnail(video)} alt=""/> : LiveSVG}
          <LiveStatus live={live}/>
          <h2>{t(failed || playback.isError && available ? 'livePlaybackInterrupted' : `liveMessage_${live.status}`)}</h2>
          {live.scheduled_start_at && live.status === 'scheduled' && <p>{new Date(live.scheduled_start_at).toLocaleString()}</p>}
          <p>{t(live.policy_sync_pending ? 'livePolicyPending' : 'liveUpdatesAutomatically')}</p>
          {(failed || playback.isError && available) && <button className="liveButton" onClick={() => { setFailed(false); void playback.refetch(); }}>{t('usersRetry')}</button>}
        </div>}
      </div>
      <VideoInfo props={video} onOpenChapter={() => {}} onOpenTranscript={() => {}} />
      <CommentsSection videoId={video.id} refreshInterval={15000}/>
    </div>
    <div className="relevant flex flex-col gap-7"><Similar props={similar} isLoading={loadingSimilar}/></div>
  </main>;
}
