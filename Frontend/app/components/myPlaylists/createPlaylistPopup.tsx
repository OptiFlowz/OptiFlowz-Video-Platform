import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreate: (title: string) => Promise<void>;
};

function CreatePlaylistPopup({ open, onClose, onCreate }: Props) {
  const DURATION = 200;
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        window.clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setVisible(false);
      setTitle("");
      setError(null);
      setIsSubmitting(false);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setVisible(true);
          inputRef.current?.focus();
        });
      });
      return;
    }

    setVisible(false);
    closeTimeoutRef.current = window.setTimeout(() => setMounted(false), DURATION);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSubmitting) {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isSubmitting, onClose, open]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      setError("Playlist title is required.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await onCreate(normalizedTitle);
      setTitle("");
    } catch (err) {
      console.error("Error creating playlist:", err);
      setError("Failed to create playlist.");
      setIsSubmitting(false);
    }
  };

  if (!mounted) return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-200 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
      role="dialog"
      aria-modal="true"
      aria-label="Create playlist"
      onMouseDown={() => {
        if (!isSubmitting) onClose();
      }}
    >
      <div
        className={`absolute inset-0 bg-black/55 transition-opacity duration-200 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
      />

      <div
        className={`relative w-[min(480px,92vw)] rounded-3xl border border-(--border1) bg-(--background1) p-6 shadow-2xl transition-all duration-200 ease-out ${
          visible ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
        }`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-xl font-semibold">Create playlist</h3>
            <p className="mt-2 text-sm opacity-80">
              Enter a title and create a new playlist.
            </p>
          </div>
        </div>

        <form className="mt-5 flex flex-col gap-4" onSubmit={handleSubmit}>
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium">Title</span>
            <input
              ref={inputRef}
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Playlist title"
              className="w-full rounded-2xl border border-(--border1) bg-(--background2) px-4 py-3 outline-none transition-colors focus:border-(--accentBlue)"
              maxLength={120}
              disabled={isSubmitting}
            />
          </label>

          {error && <p className="text-sm text-(--accentRed)">{error}</p>}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="button cursor-pointer rounded-full bg-(--background2) px-5 py-2.5 hover:bg-(--background3)"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="button cursor-pointer rounded-full bg-(--accentBlue) px-5 py-2.5 text-white hover:bg-(--accentBlue2) disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSubmitting ? "Creating..." : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

export default CreatePlaylistPopup;
