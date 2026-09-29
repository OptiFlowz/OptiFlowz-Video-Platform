import { useI18n } from '~/i18n';
import { liveStatusKey, type LiveStatus as Status } from './api';
import './live.css';
export default function LiveStatus({ live, scheduledAt }: { live?: { status: Status } | null; scheduledAt?: string | null }) {
  const { t, locale } = useI18n();
  if (!live) return null;
  const date = live.status === 'scheduled' && scheduledAt ? new Date(scheduledAt) : null;
  const formattedDate = date && !Number.isNaN(date.getTime())
    ? new Intl.DateTimeFormat(locale === 'sr' ? 'sr-Latn' : locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date) : null;
  return <span className={`liveBadge liveBadge--${live.status}`}>{t(`liveStatus_${liveStatusKey(live.status)}`)}{formattedDate && <> – <time dateTime={scheduledAt!}>{formattedDate}</time></>}</span>;
}
