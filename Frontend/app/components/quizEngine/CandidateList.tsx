import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { DndContext, DragOverlay, MouseSensor, TouchSensor, KeyboardSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { MenuSVG, DeleteSVG, EditSVG } from '~/constants';
import { useI18n } from '~/i18n';
import { numberDraftValue } from './numberDraft';
import { typeLabels, type Candidate } from './model';
import styles from './engine.module.css';
import { FieldHelp } from './shared';

type CardProps = {
  row: Candidate; index: number; editable: boolean; busy: boolean;
  onPoints: (row: Candidate, points: number) => Promise<boolean>;
  onDirty: (id: string, dirty: boolean) => void;
  onRemove: (row: Candidate) => void;
  onEdit?: (row: Candidate) => void;
  selected?: string[]; onSelect?: (id: string, checked: boolean) => void;
};

function PointsInput({ row, busy, onPoints, onDirty }: Pick<CardProps, 'row' | 'busy' | 'onPoints' | 'onDirty'>) {
  const { t } = useI18n();
  const [value, setValue] = useState<number | ''>(Number(row.max_points));
  const saving = useRef(false);
  useEffect(() => { setValue(Number(row.max_points)); }, [row.max_points]);
  const save = async (input: HTMLInputElement) => {
    if (saving.current || busy || !input.reportValidity() || value === '' || value === Number(row.max_points)) return;
    saving.current = true;
    try { if (await onPoints(row, value)) onDirty(row.question_id, false); }
    finally { saving.current = false; }
  };
  return <div className={styles.candidatePoints} data-no-drag><div className={styles.fieldLabel}><label htmlFor={`points-${row.question_id}`}>{t('quizPoints')}</label><FieldHelp label={t('quizPoints')} help={t('qeHelp_max_points')} /></div>
    <input id={`points-${row.question_id}`} type="number" required min={0.01} max={99999999.99} step={0.01} value={value} disabled={busy}
      aria-label={`${t('quizPoints')}: ${row.question.content || t('qeUntitledQuestion')}`}
      onChange={event => { const next = numberDraftValue(event.target.value); setValue(next); onDirty(row.question_id, next !== Number(row.max_points)); }}
      onBlur={event => { void save(event.currentTarget); }}
      onKeyDown={event => {
        if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setValue(Number(row.max_points)); onDirty(row.question_id, false); }
      }} />
  </div>;
}

function CandidateCard({ row, index, editable, busy, onPoints, onDirty, onRemove, onEdit, selected, onSelect, handle }: CardProps & { handle?: ReactNode }) {
  const { t } = useI18n();
  return <article className={`${styles.partCard} ${styles.candidateCard}`}>
    <div className={styles.candidateLeading}>{editable && onSelect && <input className={styles.candidateCheckbox} type="checkbox" aria-label={`${t('quizSelect')}: ${row.question.content || t('qeUntitledQuestion')}`} checked={selected?.includes(row.question_id) ?? false} disabled={busy} onChange={event => onSelect(row.question_id, event.target.checked)} />}{handle}<span className={styles.candidatePosition}>{index + 1}</span></div>
    <div className={styles.candidateContent}>
      <p>{row.question.content || t('qeUntitledQuestion')}</p>
      <span className={styles.partMeta}>{t(typeLabels[row.question.type])} · {row.question.category?.name || t('qeUncategorized')}{!editable && <> · {t('quizPointsShort', { count: row.max_points })}</>}</span>
    </div>
    {editable && <div className={`${styles.partActions} ${styles.candidateActions}`}>
      <PointsInput row={row} busy={busy} onPoints={onPoints} onDirty={onDirty} />
      {onEdit && <button type="button" className={styles.candidateEdit} disabled={busy} onClick={() => onEdit(row)}
        aria-label={`${t('adminEdit')}: ${row.question.content || t('qeUntitledQuestion')}`} title={t('adminEdit')}>{EditSVG}</button>}
      <button type="button" className={styles.partRemove} disabled={busy} onClick={() => onRemove(row)}
        aria-label={`${t('quizRemove')}: ${row.question.content || t('qeUntitledQuestion')}`} title={t('quizRemove')}>{DeleteSVG}</button>
    </div>}
  </article>;
}

function SortableCandidate(props: CardProps) {
  const { t } = useI18n();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: props.row.question_id, disabled: props.busy || !props.editable });
  const canDragFrom = (target: EventTarget | null) => props.editable && !props.busy && target instanceof Element
    && !target.closest('button, input, textarea, select, label, a, [data-no-drag], [role="button"], [contenteditable="true"]');
  return <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }}
    className={`${props.editable && !props.busy ? styles.candidateSortable : ''} ${isDragging ? styles.candidateDragging : ''}`}
    onMouseDown={event => { if (canDragFrom(event.target)) listeners?.onMouseDown?.(event); }}
    onTouchStart={event => { if (canDragFrom(event.target)) listeners?.onTouchStart?.(event); }}>
    <CandidateCard {...props} handle={props.editable && <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners}
      className={styles.candidateHandle} disabled={props.busy} aria-label={t('quizDragQuestion', { position: props.index + 1 })} title={t('quizDragToReorder')}>{MenuSVG}</button>} />
  </div>;
}

export default function CandidateList({ rows, editable, busy, onMove, onPoints, onDirty, onRemove, onEdit, selected, onSelect }: Omit<CardProps, 'row' | 'index'> & {
  rows: Candidate[]; onMove: (id: string, targetId: string) => void;
}) {
  const { t } = useI18n(), [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const activeIndex = rows.findIndex(row => row.question_id === activeId);
  const announcement = (id: string | number, target: string | number = id) => `${rows.find(row => row.question_id === id)?.question.content ?? ''}: ${rows.findIndex(row => row.question_id === target) + 1} / ${rows.length}`;
  return <DndContext sensors={sensors} collisionDetection={closestCenter}
    accessibility={{ screenReaderInstructions: { draggable: t('playlistReorderHelp') }, announcements: {
      onDragStart: ({ active }) => announcement(active.id),
      onDragOver: ({ active, over }) => over ? announcement(active.id, over.id) : undefined,
      onDragEnd: ({ active, over }) => over ? announcement(active.id, over.id) : t('cancel'),
      onDragCancel: () => t('cancel'),
    } }}
    onDragStart={({ active }) => setActiveId(String(active.id))} onDragCancel={() => setActiveId(null)}
    onDragEnd={({ active, over }) => { setActiveId(null); if (over && active.id !== over.id) onMove(String(active.id), String(over.id)); }}>
    <SortableContext items={rows.map(row => row.question_id)} strategy={verticalListSortingStrategy}>
      <div className={styles.candidateList}>{rows.map((row, index) => <SortableCandidate key={row.question_id} {...{ row, index, editable, busy, onPoints, onDirty, onRemove, onEdit, selected, onSelect }} />)}</div>
    </SortableContext>
    {typeof document !== 'undefined' && createPortal(<DragOverlay dropAnimation={null} zIndex={90}>
      {activeIndex >= 0 && <div className={`${styles.page} ${styles.candidateOverlay}`} aria-hidden="true">
        <CandidateCard row={rows[activeIndex]} index={activeIndex} editable={editable} busy onPoints={onPoints} onDirty={onDirty} onRemove={onRemove} onEdit={onEdit}
          handle={<span className={styles.candidateHandle}>{MenuSVG}</span>} />
      </div>}
    </DragOverlay>, document.body)}
  </DndContext>;
}
