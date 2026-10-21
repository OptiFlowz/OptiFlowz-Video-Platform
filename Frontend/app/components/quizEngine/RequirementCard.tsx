import { useEffect, useRef, useState } from 'react';
import { DeleteSVG } from '~/constants';
import { useI18n } from '~/i18n';
import { Field, Select, styles } from './shared';
import { numberDraftValue } from './numberDraft';
import type { Requirement } from './model';

export type RuleThreshold = Pick<Requirement, 'min_watch_percentage' | 'min_watch_seconds'>;
type Mode = 'percentage' | 'seconds';
export default function RequirementCard({ row, editable, busy, onSave, onRemove, onChangeVideo, onDirty }: {
  row: Requirement; editable: boolean; busy: boolean;
  onSave: (threshold: RuleThreshold) => Promise<boolean>;
  onRemove: () => void; onChangeVideo: (threshold: RuleThreshold) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const { t } = useI18n();
  const savedMode: Mode = row.min_watch_percentage !== null ? 'percentage' : 'seconds';
  const savedValue = Number(row.min_watch_percentage ?? row.min_watch_seconds);
  const [mode, setMode] = useState<Mode>(savedMode), [value, setValue] = useState<number | ''>(savedValue);
  const input = useRef<HTMLInputElement>(null), saving = useRef(false);
  useEffect(() => { setMode(savedMode); setValue(savedValue); }, [savedMode, savedValue]);
  const threshold = (nextMode: Mode, nextValue: number): RuleThreshold => ({ min_watch_percentage: nextMode === 'percentage' ? nextValue : null, min_watch_seconds: nextMode === 'seconds' ? nextValue : null });
  const save = async (nextMode: Mode, nextValue: number | '') => {
    if (!editable || busy || saving.current || nextValue === '' || (nextMode === savedMode && nextValue === savedValue)) return;
    saving.current = true;
    try { if (await onSave(threshold(nextMode, nextValue))) onDirty(false); }
    finally { saving.current = false; }
  };
  const title = row.video_card?.title || t('quizRequiredVideo');
  const image = row.video_card?.thumbnail_url || row.video_card?.mux_thumbnail_url;
  return <article className={`${styles.partCard} ${styles.ruleCard}`} aria-label={title}>
    <div className={styles.ruleIdentity}>
      {image ? <img className={styles.partThumbnail} src={image} alt="" /> : <div className={styles.partThumbnail}>{t('quizNoThumbnail')}</div>}
      <div className={styles.ruleTitle}><p>{title}</p>{editable && <button type="button" className={styles.ruleChangeVideo} disabled={busy} onClick={() => {
        if (value !== '' && input.current?.reportValidity()) onChangeVideo(threshold(mode, value));
      }}>{t('qeChangeVideo')}</button>}</div>
    </div>
    <div className={styles.ruleFields}>
      <Field label={t('quizRuleType')} help={`${t('quizVideoWatchPercentageHelp')} ${t('quizVideoWatchSecondsHelp')}`}><Select label={`${t('quizRuleType')}: ${title}`} value={mode} disabled={!editable || busy}
        values={[{ value: 'percentage', label: t('quizVideoWatchPercentage') }, { value: 'seconds', label: t('quizVideoWatchSeconds') }]}
        onChange={next => { const nextMode = next as Mode, nextValue = nextMode === 'percentage' ? 100 : 1; setMode(nextMode); setValue(nextValue); onDirty(nextMode !== savedMode || nextValue !== savedValue); void save(nextMode, nextValue); }} /></Field>
      <Field label={t(mode === 'percentage' ? 'quizRequiredPercentage' : 'quizRequiredSeconds')} help={t(mode === 'percentage' ? 'quizVideoWatchPercentageHelp' : 'quizVideoWatchSecondsHelp')}><input ref={input} aria-label={`${t(mode === 'percentage' ? 'quizRequiredPercentage' : 'quizRequiredSeconds')}: ${title}`} required type="number"
        min={mode === 'percentage' ? 0.01 : 1} max={mode === 'percentage' ? 100 : row.video_card?.duration_seconds ?? 2147483647} step={mode === 'percentage' ? 0.01 : 1} value={value} disabled={!editable || busy}
        onChange={event => { const next = numberDraftValue(event.target.value); setValue(next); onDirty(mode !== savedMode || next !== savedValue); }}
        onBlur={event => { if (event.currentTarget.reportValidity()) void save(mode, value); }}
        onKeyDown={event => {
          if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setMode(savedMode); setValue(savedValue); onDirty(false); }
        }} /></Field>
    </div>
    {editable && <button type="button" className={`${styles.icon} ${styles.danger}`} disabled={busy} title={t('quizRemove')} aria-label={`${t('quizRemove')}: ${title}`} onClick={onRemove}>{DeleteSVG}</button>}
  </article>;
}
