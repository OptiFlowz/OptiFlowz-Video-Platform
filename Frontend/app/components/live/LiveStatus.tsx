import { useI18n } from '~/i18n';
import { liveStatusKey, type LiveStatus as Status } from './api';
import './live.css';
export default function LiveStatus({ live }: { live?: { status: Status } | null }) {
  const { t } = useI18n();
  if (!live) return null;
  return <span className={`liveBadge liveBadge--${live.status}`}>{t(`liveStatus_${liveStatusKey(live.status)}`)}</span>;
}
