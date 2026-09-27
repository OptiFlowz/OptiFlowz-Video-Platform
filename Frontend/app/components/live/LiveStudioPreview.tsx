import LivePlayer from './LivePlayer';
import { useI18n } from '~/i18n';
import { LiveSVG } from '~/constants';
import { useVideoPlayback } from '../playback/useVideoPlayback';
import { PlaybackFeedback } from '../playback/playbackFeedback';
import { VideoEditorPreview } from '../shared/videoEditorPreview';
import { getVideoThumbnail } from '../shared/videoMedia';
import { recordingReady, type LiveVideo } from './api';
import LiveStatus from './LiveStatus';

export default function LiveStudioPreview({ video, title }: { video?: LiveVideo; title: string }) {
  const { t } = useI18n();
  const replay = !!video && recordingReady(video);
  const playback = useVideoPlayback(video?.id, !!video?.playback_available && !replay);
  if (video && replay) return <VideoEditorPreview videoData={video} title={title} isVideoLoading={false} chapters={[]} revision={0}/>;

  return <div className="videoPreviewContainer">
    <div className="videoPreviewWrapper liveStudioPreview">
      {video?.playback_available ? playback.data ? <LivePlayer
        title={title} dvr={playback.data.stream_type === 'live:dvr'} compact
        src={playback.data.stream_url}
        streamType="live"
        targetLiveWindow={playback.data.stream_type === 'live:dvr' ? Infinity : 0}
        autoPlay={false} muted playsInline
        accentColor="var(--accentBlue3)"
        poster={getVideoThumbnail(video) || undefined}
        metadata={{ video_id: video.id, video_title: title }}
      /> : <PlaybackFeedback error={playback.isError} retry={() => void playback.refetch()}/>
        : <div className="liveStudioPreviewPlaceholder">{LiveSVG}<p>{t(video ? `liveMessage_${video.livestream.status}` : 'liveHowItWorks')}</p></div>}
    </div>
    <div className="videoPreviewInfo">
      <h3 className="videoPreviewTitle">{title || t('liveCreate')}</h3>
      {video && <LiveStatus live={video.livestream}/>}
    </div>
  </div>;
}
