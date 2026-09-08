import { useState } from "react";
import { createPortal } from "react-dom";
import { DndContext, DragOverlay, MouseSensor, TouchSensor, KeyboardSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, useSortable, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Link } from "react-router";
import { MenuSVG, DeleteSVG } from "~/constants";
import { useI18n } from "~/i18n";
import { getVideoThumbnail } from "~/components/shared/videoMedia";
import type { PlaylistVideoT } from "~/types";
import styles from "./editPlaylistPage.module.css";

function VideoContent({ video, index }: { video: PlaylistVideoT; index: number }) {
  return <>
    <img src={getVideoThumbnail(video)} alt="" loading="lazy" draggable={false} />
    <span className={styles.videoInfo}><strong>{index + 1}. {video.title}</strong><small>{video.uploader_name}</small></span>
  </>;
}

function SortableVideo({ video, index, disabled, onDelete }: { video: PlaylistVideoT; index: number; disabled: boolean; onDelete: (id: string) => void }) {
  const { t } = useI18n();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: video.id, disabled });
  return <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} className={`${styles.videoRow} ${isDragging ? styles.dragging : ""}`}>
    <button ref={setActivatorNodeRef} type="button" {...attributes} {...listeners} disabled={disabled}
      className={styles.dragHandle} aria-label={`${t("quizDragToReorder")}: ${video.title}`} title={t("quizDragToReorder")}>{MenuSVG}</button>
    <Link to={`/video/${video.id}`} draggable={false} className={styles.videoLink}><VideoContent video={video} index={index} /></Link>
    <button type="button" disabled={disabled} className={styles.deleteButton} onClick={() => onDelete(video.id)}
      aria-label={`${t("adminDelete")}: ${video.title}`} title={t("adminDelete")}>{DeleteSVG}</button>
  </div>;
}

export default function PlaylistVideoList({ videos, disabled, onMove, onDelete }: {
  videos: PlaylistVideoT[]; disabled: boolean;
  onMove: (id: string, targetId: string) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useI18n();
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const activeIndex = videos.findIndex(video => video.id === activeId);
  const announcement = (id: string | number, target: string | number = id) => {
    const video = videos.find(video => video.id === id);
    return `${video?.title ?? ""}: ${videos.findIndex(video => video.id === target) + 1} / ${videos.length}`;
  };
  return <DndContext sensors={sensors} collisionDetection={closestCenter}
    accessibility={{ screenReaderInstructions: { draggable: t("playlistReorderHelp") }, announcements: {
      onDragStart: ({ active }) => announcement(active.id),
      onDragOver: ({ active, over }) => over ? announcement(active.id, over.id) : undefined,
      onDragEnd: ({ active, over }) => over ? announcement(active.id, over.id) : t("cancel"),
      onDragCancel: () => t("cancel"),
    } }}
    onDragStart={({ active }) => setActiveId(String(active.id))}
    onDragCancel={() => setActiveId(null)}
    onDragEnd={({ active, over }) => { setActiveId(null); if (over && active.id !== over.id) onMove(String(active.id), String(over.id)); }}>
    <SortableContext items={videos.map(video => video.id)} strategy={verticalListSortingStrategy}>
      <div className={styles.videoList}>{videos.map((video, index) => <SortableVideo key={video.id} video={video} index={index} disabled={disabled} onDelete={onDelete} />)}</div>
    </SortableContext>
    {typeof document !== "undefined" && createPortal(<DragOverlay dropAnimation={null}>
      {activeIndex >= 0 ? <div className={`${styles.videoRow} ${styles.dragOverlay}`}><span className={styles.dragHandle}>{MenuSVG}</span><div className={styles.videoLink}><VideoContent video={videos[activeIndex]} index={activeIndex} /></div></div> : null}
    </DragOverlay>, document.body)}
  </DndContext>;
}
