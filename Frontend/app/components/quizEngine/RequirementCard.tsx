import { formatDuration } from '~/functions';
import { DeleteSVG } from '~/constants';
import { useI18n } from '~/i18n';
import { styles } from './shared';
import type { Requirement } from './model';

export type RuleThreshold = Pick<Requirement, 'min_watch_percentage' | 'min_watch_seconds'>;
export default function RequirementCard({ row, editable, busy, onEdit, onRemove, onChangeVideo, onActiveChange, selected, onSelect }: {
  row: Requirement; editable: boolean; busy: boolean;
  selected: boolean; onSelect: (checked: boolean) => void;
  onEdit: () => void;
  onRemove: () => void; onChangeVideo: (threshold: RuleThreshold) => void;
  onActiveChange: (active: boolean) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const title = row.video_card?.title || t('quizRequiredVideo');
  const image = row.video_card?.thumbnail_url || row.video_card?.mux_thumbnail_url;
  const percentage = row.min_watch_percentage !== null;
  return <article className={`${styles.partCard} ${styles.ruleCard}`} aria-label={title}>
    <div className={styles.ruleIdentity}>
      {editable && <input className={styles.candidateCheckbox} type="checkbox" aria-label={`${t('quizSelect')}: ${title}`} checked={selected} disabled={busy} onChange={event => onSelect(event.target.checked)} />}
      <div className={styles.ruleThumbnail}>
        {image ? <img src={image} alt="" /> : <span>{t('quizNoThumbnail')}</span>}
        {row.video_card?.duration_seconds != null && <span className={styles.ruleDuration}>{formatDuration(row.video_card.duration_seconds)}</span>}
      </div>
      <div className={styles.ruleTitle}>
        <p>{title}</p>
        <small className={styles.ruleSummary}>{t(percentage ? 'quizRequiredPercentage' : 'quizRequiredSeconds')}: {percentage ? `${row.min_watch_percentage}%` : row.min_watch_seconds}</small>
        {editable && <button type="button" className={styles.ruleChangeVideo} disabled={busy} onClick={() => onChangeVideo({ min_watch_percentage: row.min_watch_percentage, min_watch_seconds: row.min_watch_seconds })}>{t('qeChangeVideo')}</button>}
      </div>
    </div>
    <div className={styles.ruleControls}>
      <label className={`${styles.check} ${styles.ruleActive}`}><input type="checkbox" aria-label={`${t('quizRuleActive')}: ${title}`} checked={row.is_active !== false} disabled={!editable || busy} onChange={event => { void onActiveChange(event.target.checked); }} /><span>{t('adminActive')}</span></label>
      {editable && <>
        <button type="button" className={styles.button} disabled={busy} aria-label={`${t('quizEditRule')}: ${title}`} onClick={onEdit}>{t('adminEdit')}</button>
        <button type="button" className={`${styles.icon} ${styles.danger}`} disabled={busy} title={t('quizRemove')} aria-label={`${t('quizRemove')}: ${title}`} onClick={onRemove}>{DeleteSVG}</button>
      </>}
    </div>
  </article>;
}
