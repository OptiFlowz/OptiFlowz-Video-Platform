import { useRef, useState, type DragEvent, type ReactNode } from "react";
import "./thumbnailDropZone.css";

type Props = {
  as?: "section" | "div";
  className?: string;
  disabled?: boolean;
  onFileSelect: (file: File) => void;
  children: ReactNode;
};

export const isThumbnailImage = (file: File) => file.type.startsWith("image/") ||
  (!file.type && /\.(avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|tiff?|webp)$/i.test(file.name));

// Keep dropped files on the same selection/upload path as the file picker.
export function ThumbnailDropZone({ as: Tag = "section", className, disabled = false, onFileSelect, children }: Props) {
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const isFileDrag = (event: DragEvent<HTMLElement>) => Array.from(event.dataTransfer.types).includes("Files");
  const capture = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  return <Tag className={className} data-thumbnail-drop={dragging && !disabled ? "active" : "idle"}
    onDragStart={event => {
      if (event.target instanceof HTMLImageElement) event.preventDefault();
    }}
    onDragEnter={event => {
      if (!isFileDrag(event)) return;
      capture(event);
      depth.current += 1;
      if (!disabled) setDragging(true);
    }}
    onDragOver={event => {
      if (!isFileDrag(event)) return;
      capture(event);
      event.dataTransfer.dropEffect = disabled ? "none" : "copy";
    }}
    onDragLeave={event => {
      if (!isFileDrag(event) && !depth.current) return;
      capture(event);
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setDragging(false);
    }}
    onDrop={event => {
      if (!isFileDrag(event) && !event.dataTransfer.files.length) return;
      capture(event);
      depth.current = 0;
      setDragging(false);
      const file = event.dataTransfer.files[0];
      if (!disabled && file) onFileSelect(file);
    }}
  >{children}</Tag>;
}
