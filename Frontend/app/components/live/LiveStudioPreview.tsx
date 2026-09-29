import { useI18n } from '~/i18n';
import { LiveSVG } from '~/constants';
import type { LiveDetails } from './api';
import LiveStatus from './LiveStatus';
import LivePlaybackView from './LivePlaybackView';
export default function LiveStudioPreview({ live, title }: { live?: LiveDetails; title: string }) {
  const { t } = useI18n();
  return <div className="videoPreviewContainer">
    <div className="videoPreviewWrapper liveStudioPreview">
      {live ? <LivePlaybackView key={live.id} live={live} compact/> : <div className="liveStudioPreviewPlaceholder">{LiveSVG}<p>{t('liveHowItWorks')}</p></div>}
    </div>
    <div className="videoPreviewInfo"><h3 className="videoPreviewTitle">{title || t('liveCreate')}</h3>{live && <LiveStatus live={live}/>}</div>
  </div>;
}
