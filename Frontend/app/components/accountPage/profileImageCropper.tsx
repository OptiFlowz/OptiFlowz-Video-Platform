import { useEffect, useRef, useState } from "react";
import { useI18n } from "~/i18n";
import styles from "./profileImageCropper.module.css";

type Point = { x: number; y: number };

export default function ProfileImageCropper({ file, onCancel, onApply }: {
  file: File; onCancel: () => void; onApply: (file: File) => void;
}) {
  const { t } = useI18n();
  const [url, setUrl] = useState("");
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; offset: Point } | null>(null);
  const active = useRef(false);
  const shortest = Math.min(size.width, size.height);
  const ready = shortest > 0 && !error;

  useEffect(() => {
    active.current = true;
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => { active.current = false; URL.revokeObjectURL(next); };
  }, [file]);

  const constrain = (point: Point, scale = zoom): Point => {
    if (!shortest) return { x: 0, y: 0 };
    const maxX = Math.max(0, (size.width / shortest * scale - 1) / 2);
    const maxY = Math.max(0, (size.height / shortest * scale - 1) / 2);
    return { x: Math.max(-maxX, Math.min(maxX, point.x)), y: Math.max(-maxY, Math.min(maxY, point.y)) };
  };
  const save = async () => {
    if (!ready || busy || !image.current) return;
    setBusy(true);
    const canvas = document.createElement("canvas");
    try {
      const cropSize = shortest / zoom;
      const outputSize = Math.max(1, Math.min(1024, Math.round(cropSize)));
      canvas.width = canvas.height = outputSize;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      const sx = Math.max(0, Math.min(size.width - cropSize, size.width / 2 - (offset.x + .5) * cropSize));
      const sy = Math.max(0, Math.min(size.height - cropSize, size.height / 2 - (offset.y + .5) * cropSize));
      context.drawImage(image.current, sx, sy, cropSize, cropSize, 0, 0, outputSize, outputSize);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", .94));
      if (!blob || blob.size > 4 * 1024 * 1024) throw new Error("Invalid cropped image");
      if (!active.current) return;
      const extension = blob.type === "image/webp" ? "webp" : "png";
      onApply(new File([blob], `${file.name.replace(/\.[^.]+$/, "")}-cropped.${extension}`, { type: blob.type }));
    } catch {
      if (active.current) setError(true);
    } finally {
      canvas.width = canvas.height = 0;
      if (active.current) setBusy(false);
    }
  };

  return <div className={styles.cropper}>
    <div className={styles.body}>
      <p id="profileCropHint" className={styles.hint}>{t("profileCropHint")}</p>
      <div className={styles.viewport} role="group" aria-label={t("profileCropTitle")} aria-describedby="profileCropHint"
        tabIndex={ready && !busy ? 0 : -1} data-dragging={dragging}
        onPointerDown={(event) => {
          if (!ready || busy || event.button !== 0 || drag.current) return;
          event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, offset }; setDragging(true);
        }}
        onPointerMove={(event) => {
          const origin = drag.current;
          if (!origin || origin.id !== event.pointerId || busy) return;
          const width = event.currentTarget.getBoundingClientRect().width;
          if (width) setOffset(constrain({ x: origin.offset.x + (event.clientX - origin.x) / width, y: origin.offset.y + (event.clientY - origin.y) / width }));
        }}
        onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
        onLostPointerCapture={() => { drag.current = null; setDragging(false); }}
        onKeyDown={(event) => {
          if (!ready || busy) return;
          const step = event.shiftKey ? .05 : .01;
          const movements: Record<string, Point> = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step } };
          const move = movements[event.key];
          if (move) { event.preventDefault(); setOffset(constrain({ x: offset.x + move.x, y: offset.y + move.y })); }
        }}>
        {url && <img ref={image} src={url} alt="" draggable={false}
          onLoad={(event) => { setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }); setError(false); }}
          onError={() => setError(true)}
          style={{ width: shortest ? `${size.width / shortest * zoom * 100}%` : "100%", height: shortest ? `${size.height / shortest * zoom * 100}%` : "100%", left: `${50 + offset.x * 100}%`, top: `${50 + offset.y * 100}%` }} />}
        {ready && <div className={styles.grid} aria-hidden="true" />}
        <div className={styles.mask} aria-hidden="true" />
      </div>
      <label className={styles.zoom}>
        <span>{t("profileCropZoom")} <strong>{zoom.toFixed(1)}×</strong></span>
        <input type="range" min={1} max={3} step={.01} value={zoom} disabled={!ready || busy}
          onChange={(event) => { const next = Number(event.target.value); setZoom(next); setOffset(constrain(offset, next)); }} />
      </label>
      {error && <p className={styles.error} role="alert">{t("profileCropError")}</p>}
    </div>
    <div className="editButtons">
      <button type="button" onClick={onCancel}>{t("cancel")}</button>
      <button type="button" onClick={() => void save()} disabled={!ready || busy}>{t(busy ? "saving" : "profileCropApply")}</button>
    </div>
  </div>;
}
