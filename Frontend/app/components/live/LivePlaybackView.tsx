import { useEffect, useRef, useState } from 'react';
import type MuxPlayerElement from '@mux/mux-player';
import { LiveSVG } from '~/constants';
import { useI18n } from '~/i18n';
import { useQueryClient } from '@tanstack/react-query';
import { canPlayLive, liveStatusKey, type LiveDetails, type LivePlayback } from './api';
import { useLivePlayback } from './useLiveStream';
import LivePlayer from './LivePlayer';
import LiveStatus from './LiveStatus';

export default function LivePlaybackView({ live, compact = false }: { live: LiveDetails; compact?: boolean }) {
  const { t } = useI18n();
  const client = useQueryClient();
  const playback = useLivePlayback(live);
  const player = useRef<MuxPlayerElement | null>(null);
  const [source, setSource] = useState<LivePlayback>();
  const [failed, setFailed] = useState(false);
  const [startedPlaybackId, setStartedPlaybackId] = useState<string>();
  const resume = useRef<{ time?: number; paused: boolean; muted: boolean; volume: number } | null>(null);
  useEffect(() => {
    const next = playback.data;
    if (!next) { setSource(undefined); setStartedPlaybackId(undefined); resume.current = null; return; }
    if (next.stream_url === source?.stream_url) return;
    const element = player.current;
    // Focus refetches and signed URL renewal must keep the viewer's choices.
    resume.current = source?.mux_playback_id === next.mux_playback_id && element
      ? { time: next.playback_mode === 'dvr' ? element.currentTime : undefined,
          paused: element.paused, muted: element.muted, volume: element.volume } : null;
    setSource(next);
  }, [playback.data, source]);
  useEffect(() => { setFailed(false); }, [playback.dataUpdatedAt]);
  const ready = canPlayLive(live) && playback.data && source && playback.data.mux_playback_id === source.mux_playback_id;
  return ready && source && !failed ? <LivePlayer
    ref={player} key={source.mux_playback_id} title={live.title} compact={compact}
    startedAt={live.current_recording?.recording_started_at || live.started_at || live.connected_at}
    dvr={source.playback_mode === 'dvr'} src={source.stream_url} streamType="live"
    targetLiveWindow={source.playback_mode === 'dvr' ? Infinity : 0}
    // Muted autoplay is only for the initial start, never a source reload.
    autoPlay={compact || startedPlaybackId === source.mux_playback_id ? false : 'muted'} muted={compact} playsInline
    accentColor="var(--accentBlue3)" poster={live.thumbnail_url || undefined}
    metadata={{ video_id: source.video_id || live.id, video_title: live.title }}
    onPlaying={() => setStartedPlaybackId(source.mux_playback_id)}
    onLoadedMetadata={() => {
      const saved = resume.current, element = player.current;
      if (!saved || !element) return;
      resume.current = null;
      element.volume = saved.volume;
      element.muted = saved.muted;
      if (saved.time !== undefined && Number.isFinite(saved.time) && element.seekable.length) element.currentTime = Math.min(element.seekable.end(element.seekable.length - 1), Math.max(element.seekable.start(0), saved.time));
      if (saved.paused) element.pause(); else void element.play().catch(() => {});
    }}
    onEnded={() => { void client.invalidateQueries({ queryKey: ['live-details', live.id] }); void playback.refetch(); }}
    onError={() => { setStartedPlaybackId(undefined); setFailed(true); }}
  /> : <div className="liveWaiting" role="status">
    {live.thumbnail_url && !compact ? <img src={live.thumbnail_url} alt=""/> : LiveSVG}
    <LiveStatus live={live} scheduledAt={live.scheduled_at}/>
    <h2>{t(failed || playback.isError && canPlayLive(live) ? 'livePlaybackInterrupted' : `liveMessage_${liveStatusKey(live.status)}`)}</h2>
    <p>{t('liveUpdatesAutomatically')}</p>
    {(failed || playback.isError) && <button className="liveButton" onClick={() => { setFailed(false); void playback.refetch(); }}>{t('usersRetry')}</button>}
  </div>;
}
