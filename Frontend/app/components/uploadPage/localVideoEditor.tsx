import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { useI18n } from "~/i18n";
import { TrimVideoSVG } from "~/constants";
import { readLocalVideoDuration, trimVideoFile } from "./trimVideo";
import styles from "./localVideoEditor.module.css";
import { createVideoThumbnails } from "./videoThumbnails";

const timecode = (seconds: number) => {
  const hundredths = Math.round(Math.max(0, seconds) * 100);
  const hours = Math.floor(hundredths / 360000);
  const minutes = Math.floor(hundredths / 6000) % 60;
  const secs = Math.floor(hundredths / 100) % 60;
  return `${hours ? `${hours.toString().padStart(2, "0")}:` : ""}${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${(hundredths % 100).toString().padStart(2, "0")}`;
};
const parseTime = (value: string) => {
  if (!/^\d+(?::[0-5]?\d){0,2}(?:[.,]\d{1,3})?$/.test(value.trim())) return NaN;
  return value.trim().replace(",", ".").split(":").reduce((total, part) => total * 60 + Number(part), 0);
};

function TimeInput({ label, value, disabled, onChange }: { label: string; value: number; disabled: boolean; onChange: (value: number) => number }) {
  const [text, setText] = useState(timecode(value));
  useEffect(() => setText(timecode(value)), [value]);
  const commit = () => {
    const next = parseTime(text);
    setText(timecode(Number.isFinite(next) ? onChange(next) : value));
  };
  return <label className={styles.timeInput}><span>{label}</span>
    <input type="text" inputMode="decimal" value={text} disabled={disabled} aria-label={label}
      onChange={(event) => setText(event.target.value)} onBlur={commit}
      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} />
  </label>;
}

export default function LocalVideoEditor({ file, disabled, onChange, onRemove, onEditingChange }: {
  file: File; disabled: boolean; onChange: (file: File) => void; onRemove: () => void; onEditingChange: (editing: boolean) => void;
}) {
  const { t } = useI18n();
  const [original, setOriginal] = useState(file);
  const lastAccepted = useRef(file);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string>();
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [position, setPosition] = useState(0);
  const [error, setError] = useState("");
  const [playable, setPlayable] = useState(false);
  const [progress, setProgress] = useState(0);
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [activeHandle, setActiveHandle] = useState<"start" | "end" | null>(null);
  const player = useRef<HTMLVideoElement>(null);
  const timeline = useRef<HTMLDivElement>(null);
  const operation = useRef<AbortController | null>(null);
  const metadata = useRef<AbortController | null>(null);
  const range = useRef({ start, end });
  range.current = { start, end };
  const source = editing ? original : file;
  const minimum = Math.min(0.1, duration);

  useEffect(() => {
    if (file !== lastAccepted.current) {
      lastAccepted.current = file;
      operation.current?.abort();
      setOriginal(file); setEditing(false); setBusy(false); onEditingChange(false);
    }
  }, [file, onEditingChange]);
  useEffect(() => {
    const next = URL.createObjectURL(source);
    setUrl(next); setDuration(0); setStart(0); setEnd(0); setPosition(0); setPlayable(false); setError("");
    return () => { URL.revokeObjectURL(next); metadata.current?.abort(); };
  }, [source]);
  useEffect(() => () => { operation.current?.abort(); metadata.current?.abort(); }, []);
  useEffect(() => {
    if (!busy) return;
    const preventUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [busy]);
  useEffect(() => {
    if (!editing || !url) return;
    let frame = 0;
    const enforceEnd = () => {
      const video = player.current;
      if (video && !video.paused && video.currentTime >= range.current.end) {
        video.pause(); video.currentTime = range.current.end;
      }
      frame = requestAnimationFrame(enforceEnd);
    };
    frame = requestAnimationFrame(enforceEnd);
    return () => cancelAnimationFrame(frame);
  }, [editing, url]);

  useEffect(() => {
    setThumbnails([]);
    if (!editing || !duration) return;
    const controller = new AbortController();
    void createVideoThumbnails(original, duration, controller.signal, (image) => {
      if (!controller.signal.aborted) setThumbnails((frames) => [...frames, image]);
    }).catch(() => { /* Keep the timeline usable if a preview frame cannot be decoded. */ });
    return () => controller.abort();
  }, [editing, original, duration]);

  const setBounds = (value: number) => {
    if (!Number.isFinite(value) || value <= 0) return;
    setDuration(value); setStart(0); setEnd(value);
  };
  const loaded = async () => {
    const video = player.current;
    if (!video) return;
    setPlayable(true);
    if (Number.isFinite(video.duration) && video.duration > 0) { setBounds(video.duration); return; }
    metadata.current?.abort();
    const controller = new AbortController(); metadata.current = controller;
    try {
      const value = await readLocalVideoDuration(source, controller.signal);
      if (!Number.isFinite(value) || value <= 0) throw new Error("Invalid video duration");
      if (!controller.signal.aborted) setBounds(value);
    } catch { if (!controller.signal.aborted) setError("trimDurationError"); }
  };
  const seek = (value: number) => {
    if (!player.current) return;
    player.current.pause();
    player.current.currentTime = Math.min(duration, Math.max(0, value));
    setPosition(value);
  };
  const changeBound = (side: "start" | "end", value: number) => {
    const bounds = range.current;
    if (busy || disabled || !Number.isFinite(value)) return bounds[side];
    if (side === "start") {
      const next = Math.max(0, Math.min(value, bounds.end - minimum));
      range.current = { ...bounds, start: next }; setStart(next); seek(next);
      return next;
    } else {
      const next = Math.min(duration, Math.max(value, bounds.start + minimum));
      range.current = { ...bounds, end: next }; setEnd(next); seek(Math.max(bounds.start, next - .01));
      return next;
    }
  };
  const pointerBound = (side: "start" | "end", event: PointerEvent<HTMLButtonElement>) => {
    const rect = timeline.current?.getBoundingClientRect();
    if (rect) changeBound(side, (event.clientX - rect.left) / rect.width * duration);
  };
  const keyboardBound = (side: "start" | "end", event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? 1 : .1;
    const current = side === "start" ? start : end;
    const values: Record<string, number> = { ArrowLeft: current - step, ArrowDown: current - step,
      ArrowRight: current + step, ArrowUp: current + step, Home: side === "start" ? 0 : start + minimum,
      End: side === "start" ? end - minimum : duration };
    if (event.key in values) { event.preventDefault(); changeBound(side, values[event.key]); }
  };
  const closeEditor = () => {
    operation.current?.abort(); player.current?.pause();
    setBusy(false); setEditing(false); setActiveHandle(null); onEditingChange(false); setError("");
    setStart(0); setEnd(duration);
  };
  const commitFile = (next: File) => {
    lastAccepted.current = next;
    onChange(next); closeEditor();
  };
  const apply = async () => {
    if (busy || disabled || end <= start) return;
    if (start < .001 && end >= duration - .001) { commitFile(original); return; }
    player.current?.pause();
    const controller = new AbortController(); operation.current = controller;
    setBusy(true); setProgress(0); setError("");
    try {
      const next = await trimVideoFile(original, start, end, controller.signal, setProgress);
      if (!controller.signal.aborted) commitFile(next);
    } catch {
      if (!controller.signal.aborted) { setError("trimFailed"); setBusy(false); }
    }
  };
  const trimSupported = typeof window !== "undefined" && "VideoEncoder" in window && "VideoDecoder" in window;
  const percentages = { "--trim-start": `${duration ? start / duration * 100 : 0}%`,
    "--trim-end": `${duration ? end / duration * 100 : 100}%`,
    "--trim-position": `${duration ? position / duration * 100 : 0}%` } as CSSProperties;

  return <div className={styles.editor} onClick={(event) => event.stopPropagation()}>
    <video key={url} ref={player} className={styles.video} src={url} controls={!busy} playsInline preload="metadata"
      onLoadedMetadata={() => void loaded()} onError={() => { setPlayable(false); setError("trimPreviewError"); }}
      onPlay={() => { if (editing && player.current && (player.current.currentTime < start || player.current.currentTime >= end)) player.current.currentTime = start; }}
      onTimeUpdate={() => setPosition(player.current?.currentTime ?? 0)} />
    <div className={styles.fileHeader}>
      <div><p className={styles.name}>{file.name}</p><span className={styles.size}>{(file.size / 1024 / 1024).toFixed(2)} MB</span></div>
      {!disabled && !editing && <div className={styles.actions}>
        <button type="button" className={styles.secondary} disabled={!playable || !duration || !trimSupported}
          onClick={() => { player.current?.pause(); setEditing(true); onEditingChange(true); setStart(0); setEnd(duration); setError(""); }}>
          {TrimVideoSVG}{t("trimVideo")}
        </button>
        {file !== original && <button type="button" className={styles.secondary} onClick={() => commitFile(original)}>{t("trimRestore")}</button>}
        <button type="button" className={styles.remove} onClick={onRemove}>{t("quizRemove")}</button>
      </div>}
    </div>
    {!trimSupported && <p className={styles.hint}>{t("trimUnsupported")}</p>}
    {editing && <div className={styles.trimPanel}>
      <h3>{t("trimVideo")}</h3><p className={styles.hint}>{t("trimHelp")}</p>
      <div className={styles.timelineInset}>
        <div ref={timeline} className={styles.timeline} style={percentages} onClick={(event) => {
          if (busy) return;
          const rect = event.currentTarget.getBoundingClientRect();
          seek(Math.max(start, Math.min(end, (event.clientX - rect.left) / rect.width * duration)));
        }}>
          <div className={styles.filmstrip} aria-hidden="true">
            {Array.from({ length: 12 }, (_, index) => <div className={styles.frame} key={index}>
              {thumbnails[index] && <img src={thumbnails[index]} alt="" draggable={false} />}
            </div>)}
          </div>
          <div className={styles.selection} /><div className={styles.playhead} />
          {activeHandle && <span className={styles.handleTime} aria-hidden="true"
            style={{ left: `clamp(3.25rem, var(--trim-${activeHandle}), calc(100% - 3.25rem))` }}>
            {timecode(activeHandle === "start" ? start : end)}
          </span>}
          {(["start", "end"] as const).map((side) => <button key={side} type="button" role="slider"
            className={`${styles.handle} ${styles[side]}`} disabled={busy || disabled} data-active={activeHandle === side}
            aria-label={t(side === "start" ? "trimStart" : "trimEnd")} aria-valuemin={side === "start" ? 0 : start + minimum}
            aria-valuemax={side === "start" ? end - minimum : duration} aria-valuenow={side === "start" ? start : end}
            aria-valuetext={timecode(side === "start" ? start : end)}
            onClick={(event) => event.stopPropagation()} onKeyDown={(event) => keyboardBound(side, event)}
            onFocus={() => setActiveHandle(side)} onBlur={() => setActiveHandle(null)}
            onLostPointerCapture={() => setActiveHandle(null)}
            onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); setActiveHandle(side); event.currentTarget.setPointerCapture(event.pointerId); pointerBound(side, event); }}
            onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) pointerBound(side, event); }}
            onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
          ><span className={styles.grip} aria-hidden="true" /></button>)}
        </div>
      </div>
      <div className={styles.ruler} aria-hidden="true"><span>{timecode(0)}</span><span>{timecode(duration)}</span></div>
      <div className={styles.times}>
        <TimeInput label={t("trimStart")} value={start} disabled={busy || disabled} onChange={(value) => changeBound("start", value)} />
        <TimeInput label={t("trimEnd")} value={end} disabled={busy || disabled} onChange={(value) => changeBound("end", value)} />
        <div className={styles.length}><span>{t("trimLength")}</span><strong>{timecode(end - start)}</strong></div>
      </div>
      {busy ? <div className={styles.progress} role="status"><p>{t("trimSaving")} {Math.round(progress)}%</p>
        <progress max={100} value={progress} aria-label={t("trimSaving")} /></div> :
        <button type="button" className={styles.secondary} disabled={!duration} onClick={() => {
          if (player.current) { player.current.currentTime = start; void player.current.play().catch(() => setError("trimPreviewError")); }
        }}>{t("trimPreviewSelection")}</button>}
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} onClick={closeEditor}>{t("cancel")}</button>
        <button type="button" className={styles.primary} disabled={busy || disabled || !duration || end <= start} onClick={() => void apply()}>{t("trimUse")}</button>
      </div>
    </div>}
    {error && <p className={styles.error} role="alert">{t(error)}</p>}
  </div>;
}
