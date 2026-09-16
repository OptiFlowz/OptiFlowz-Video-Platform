import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type MuxPlayerElement from "@mux/mux-player";
import { BookmarkSVG, DeleteSVG, EditSVG } from "~/constants";
import { useI18n } from "~/i18n";
import { noteColor, noteTime, openVideoNotes, useVideoNotes, type VideoNote } from "./videoNotes";



export default function NoteMarkers({ player, videoId, compact }: { player: MuxPlayerElement | null; videoId: string; compact: boolean }) {
  const { t } = useI18n();
  const notes = useVideoNotes(videoId);
  const [controller, setController] = useState<HTMLElement | null>(null);
  const [layout, setLayout] = useState({ left: 0, top: 0, width: 0, duration: 0 });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [popupId, setPopupId] = useState<string | null>(null);
  const [popupOpen, setPopupOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markerRefs = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    const controller = player?.mediaController;
    const range = controller?.querySelector("media-time-range");
    const track = range?.shadowRoot?.querySelector("#track");
    if (!controller || !range || !track || compact) { setController(null); return; }
    setController(controller);
    const measure = () => {
      const parent = controller.getBoundingClientRect();
      const rect = track.getBoundingClientRect();
      setLayout({ left: rect.left - parent.left, top: rect.top - parent.top, width: rect.width, duration: Number(player.duration) || 0 });
    };
    const resize = new ResizeObserver(measure);
    resize.observe(controller); resize.observe(range); resize.observe(track);
    player.addEventListener("durationchange", measure);
    measure();
    return () => { resize.disconnect(); player.removeEventListener("durationchange", measure); };
  }, [player, compact]);
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);
  const show = (id: string) => { if (closeTimer.current) clearTimeout(closeTimer.current); setActiveId(id); };
  const hideSoon = () => { if (closeTimer.current) clearTimeout(closeTimer.current); closeTimer.current = setTimeout(() => setActiveId(null), 240); };
  // Retain the content until the exit transition finishes.
  useEffect(() => {
    let frame = 0;
    let nextFrame = 0;
    let removal: ReturnType<typeof setTimeout> | undefined;
    if (activeId) {
      setPopupId(activeId);
      frame = requestAnimationFrame(() => {
        nextFrame = requestAnimationFrame(() => setPopupOpen(true));
      });
    } else {
      setPopupOpen(false);
      removal = setTimeout(() => setPopupId(null), 180);
    }
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(nextFrame);
      if (removal) clearTimeout(removal);
    };
  }, [activeId]);
  const active = notes.notes.find(note => note.id === popupId);
  const visibleNotes = notes.notes.filter(note => note.timestamp <= layout.duration);
  const popupWidth = Math.min(260, layout.width);
  const position = active && layout.duration > 0 ? (active.timestamp / layout.duration) * layout.width : 0;
  const popupLeft = Math.max(0, Math.min(layout.width - popupWidth, position - 26));
  const edit = async (note: VideoNote, action: "edit" | "delete") => {
    player?.pause();
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    setActiveId(null);
    openVideoNotes({ videoId, noteId: note.id, action });
  };
  if (!controller || !notes.canRead || !layout.width || layout.duration <= 0) return null;
  return createPortal(<>
    <div className="video-note-pins" aria-hidden="true" style={{ left: layout.left, top: layout.top, width: layout.width }}>
      {visibleNotes.map(note => <span key={note.id} className="video-note-pin" data-active={activeId === note.id} style={{ left: `${note.timestamp / layout.duration * 100}%`, "--note-color": noteColor(note.color) } as CSSProperties} />)}
    </div>
    <div className="video-note-markers" style={{ left: layout.left, top: layout.top, width: layout.width }} onKeyDown={event => {
      if (event.key === "Escape") { event.stopPropagation(); const id = activeId; setActiveId(null); if (id) markerRefs.current.get(id)?.focus(); }
    }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setActiveId(null); }}>
      {visibleNotes.map(note => <button key={note.id} ref={element => { if (element) markerRefs.current.set(note.id, element); else markerRefs.current.delete(note.id); }} type="button" className="video-note-marker" aria-label={`${noteTime(note.timestamp)} — ${note.title}`} aria-expanded={activeId === note.id} style={{ left: `${note.timestamp / layout.duration * 100}%`, "--note-color": noteColor(note.color) } as CSSProperties}
        onMouseEnter={() => show(note.id)} onMouseLeave={hideSoon} onFocus={() => show(note.id)} onClick={event => { event.stopPropagation(); show(note.id); }} />)}
      {active && <section className="video-note-popup" data-open={popupOpen} inert={!activeId} aria-hidden={!activeId} aria-label={active.title} onMouseEnter={() => show(active.id)} onMouseLeave={hideSoon} style={{ left: popupLeft, width: popupWidth, "--note-color": noteColor(active.color), "--note-arrow-left": `${Math.max(12, Math.min(popupWidth - 24, position - popupLeft - 6))}px` } as CSSProperties}>
        <span className="note-popup-icon" aria-hidden="true">{BookmarkSVG}</span>
        <h3 dir="auto" title={active.title}>{active.title}</h3><p dir="auto">{active.text}</p>
        <footer>{notes.canEdit && <button type="button" aria-label={t("notesEdit")} onClick={() => void edit(active, "edit")}>{EditSVG}</button>}{notes.canDelete && <button type="button" className="note-delete" aria-label={t("notesDelete")} onClick={() => void edit(active, "delete")}>{DeleteSVG}</button>}</footer>
      </section>}
    </div>
  </>, controller);
}
