import { useI18n } from '~/i18n';
import type { Livestream } from './api';
import './live.css';
export default function LiveStatus({ live }: { live?: Livestream | null }) {
  const { t } = useI18n();
  if (!live) return null;
  return <span className={`liveBadge liveBadge--${live.status}`}>{t(live.status === 'ended' && live.recording_finalized_at ? 'liveReplay' : `liveStatus_${live.status}`)}</span>;
}
