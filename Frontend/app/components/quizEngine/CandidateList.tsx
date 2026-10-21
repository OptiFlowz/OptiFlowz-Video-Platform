import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { DndContext, DragOverlay, MouseSensor, TouchSensor, KeyboardSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { MenuSVG, DeleteSVG } from '~/constants';
import { useI18n } from '~/i18n';
import { numberDraftValue } from './numberDraft';
import { typeLabels } from './model';
import type { CandidateDraft } from './candidateDraft';
import styles from './engine.module.css';

type CardProps = {
  row: CandidateDraft; index: number; editable: boolean; busy: boolean;
  onPoints: (row: CandidateDraft, points: number | '') => void;
  onRemove: (row: CandidateDraft) => void;
};

function PointsInput({ row, busy, onPoints }: Pick<CardProps, 'row' | 'busy' | 'onPoints'>) {
  const { t } = useI18n();
  return <label className={styles.candidatePoints}><span>{t('quizPoints')}</span>
    <input type="number" required min={0.01} max={99999999.99} step={0.01} value={row.max_points} disabled={busy}
      aria-label={`${t('quizPoints')}: ${row.question.content || t('qeUntitledQuestion')}`}
      onChange={event => onPoints(row, numberDraftValue(event.target.value))}
      onKeyDown={event => {
        if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); event.currentTarget.blur(); }
      }} />
  </label>;
}

function CandidateCard({ row, index, editable, busy, onPoints, onRemove, handle }: CardProps & { handle?: ReactNode }) {
  const { t } = useI18n();
  return <article className={`${styles.partCard} ${styles.candidateCard}`}>
    <div className={styles.candidateLeading}>{handle}<span className={styles.candidatePosition}>{index + 1}</span></div>
    <div className={styles.candidateContent}>
      <p>{row.question.content || t('qeUntitledQuestion')}</p>
      <span className={styles.partMeta}>{t(typeLabels[row.question.type])} · {row.question.category?.name || t('qeUncategorized')}{!editable && <> · {t('quizPointsShort', { count: Number(row.max_points) })}</>}</span>
    </div>
    {editable && <div className={`${styles.partActions} ${styles.candidateActions}`}>
      <PointsInput row={row} busy={busy} onPoints={onPoints} />
      <button type="button" className={styles.partRemove} disabled={busy} onClick={() => onRemove(row)}
        aria-label={`${t('quizRemove')}: ${row.question.content || t('qeUntitledQuestion')}`} title={t('quizRemove')}>{DeleteSVG}</button>
    </div>}
  </article>;
}

function SortableCandidate(props: CardProps) {
  const { t } = useI18n();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: props.row.question_id, disabled: props.busy || !props.editable });
  const canDragFrom = (target: EventTarget | null) => props.editable && !props.busy && target instanceof Element
    && !target.closest('button, input, textarea, select, label, a, [contenteditable="true"]');
  return <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }}
    className={`${props.editable && !props.busy ? styles.candidateSortable : ''} ${isDragging ? styles.candidateDragging : ''}`}
    onMouseDown={event => { if (canDragFrom(event.target)) listeners?.onMouseDown?.(event); }}
    onTouchStart={event => { if (canDragFrom(event.target)) listeners?.onTouchStart?.(event); }}>
    <CandidateCard {...props} handle={props.editable && <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners}
      className={styles.candidateHandle} disabled={props.busy} aria-label={t('quizDragQuestion', { position: props.index + 1 })} title={t('quizDragToReorder')}>{MenuSVG}</button>} />
  </div>;
}

export default function CandidateList({ rows, editable, busy, onMove, onPoints, onRemove }: Omit<CardProps, 'row' | 'index'> & {
  rows: CandidateDraft[]; onMove: (id: string, targetId: string) => void;
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
      <div className={styles.candidateList}>{rows.map((row, index) => <SortableCandidate key={row.question_id} {...{ row, index, editable, busy, onPoints, onRemove }} />)}</div>
    </SortableContext>
    {typeof document !== 'undefined' && createPortal(<DragOverlay dropAnimation={null} zIndex={90}>
      {activeIndex >= 0 && <div className={`${styles.page} ${styles.candidateOverlay}`} aria-hidden="true">
        <CandidateCard row={rows[activeIndex]} index={activeIndex} editable={editable} busy onPoints={onPoints} onRemove={onRemove}
          handle={<span className={styles.candidateHandle}>{MenuSVG}</span>} />
      </div>}
    </DragOverlay>, document.body)}
  </DndContext>;
}
