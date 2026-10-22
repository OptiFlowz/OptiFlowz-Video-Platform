import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DeleteSVG } from '~/constants';
import { useI18n } from '~/i18n';
import { styles } from './shared';

export function usePartSelection(ids: string[]) {
  const [selected, setSelected] = useState<string[]>([]);
  const selectedIds = selected.filter(id => ids.includes(id));
  const signature = JSON.stringify(ids);
  useEffect(() => {
    const available = new Set<string>(JSON.parse(signature));
    setSelected(current => current.every(id => available.has(id)) ? current : current.filter(id => available.has(id)));
  }, [signature]);
  return {
    selectedIds,
    allSelected: ids.length > 0 && selectedIds.length === ids.length,
    selectAll: (checked: boolean) => setSelected(checked ? ids : []),
    select: (id: string, checked: boolean) => setSelected(current => checked ? [...current.filter(value => value !== id), id] : current.filter(value => value !== id)),
  };
}

export function PartSelectionHeader({ title, count, editable, busy, selection, onRemove, children }: {
  title: string; count?: number; editable: boolean; busy: boolean;
  selection: ReturnType<typeof usePartSelection>; onRemove: (ids: string[]) => void; children?: ReactNode;
}) {
  const { t } = useI18n(), checkbox = useRef<HTMLInputElement>(null);
  const { selectedIds, allSelected, selectAll } = selection;
  useEffect(() => { if (checkbox.current) checkbox.current.indeterminate = selectedIds.length > 0 && !allSelected; }, [selectedIds.length, allSelected]);
  return <div className={`${styles.partHeader} ${styles.candidateHeader}`}>
    {editable && <input ref={checkbox} className={styles.candidateCheckbox} type="checkbox" aria-label={`${t('qeSelectAll')}: ${title}`} checked={allSelected} disabled={busy || !count} onChange={event => selectAll(event.target.checked)} />}
    <h4 className={styles.partHeading}>{title} {count !== undefined && <span>{count}</span>}</h4>
    {editable && <div className={styles.candidateBulk} data-visible={selectedIds.length > 0} aria-hidden={!selectedIds.length}>
      <span>{t('postSelectedCount', { count: selectedIds.length })}</span>
      <button type="button" className={styles.button} tabIndex={selectedIds.length ? 0 : -1} disabled={busy || !selectedIds.length} onClick={() => onRemove(selectedIds)}>{DeleteSVG}{t('quizRemove')}</button>
    </div>}
    {children}
  </div>;
}
