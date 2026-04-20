import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import DefaultProfile from "../../../assets/DefaultProfile.webp";
import { CloseSVG, UploadSVG } from "~/constants";

export type CreatePersonPayload = {
  first_name: string;
  last_name: string;
  image_url: string;
  biography: string;
  image_file: File | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: CreatePersonPayload) => Promise<void>;
  initialValues?: CreatePersonPayload | null;
  mode?: "create" | "edit";
};

const emptyForm: CreatePersonPayload = {
  first_name: "",
  last_name: "",
  image_url: "",
  biography: "",
  image_file: null,
};

function revokePreviewUrl(url: string | null) {
  if (url?.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}

function CreatePersonPopup({
  open,
  onClose,
  onSubmit,
  initialValues,
  mode = "create",
}: Props) {
  const DURATION = 200;
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [form, setForm] = useState<CreatePersonPayload>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const firstNameRef = useRef<HTMLInputElement>(null);
  const profilePictureInputRef = useRef<HTMLInputElement>(null);
  const closeTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        window.clearTimeout(closeTimeoutRef.current);
      }

      revokePreviewUrl(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setVisible(false);
      setForm(initialValues ?? emptyForm);
      setError(null);
      setIsSubmitting(false);
      setPreviewUrl((old) => {
        revokePreviewUrl(old);
        return null;
      });
      setPreviewUrl(initialValues?.image_url || null);

      if (profilePictureInputRef.current) {
        profilePictureInputRef.current.value = "";
      }

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setVisible(true);
          firstNameRef.current?.focus();
        });
      });
      return;
    }

    setVisible(false);
    closeTimeoutRef.current = window.setTimeout(() => setMounted(false), DURATION);
  }, [initialValues, open]);

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

  const setField = (field: keyof CreatePersonPayload, value: string) => {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handlePictureChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Please select an image file.");
      event.target.value = "";
      setPreviewUrl((old) => {
        revokePreviewUrl(old);
        return null;
      });
      setForm((current) => ({ ...current, image_file: null }));
      return;
    }

    const maxBytes = 4 * 1024 * 1024;
    if (file.size > maxBytes) {
      setError("Image must be smaller than 4MB.");
      event.target.value = "";
      setPreviewUrl((old) => {
        revokePreviewUrl(old);
        return null;
      });
      setForm((current) => ({ ...current, image_file: null }));
      return;
    }

    const url = URL.createObjectURL(file);
    setPreviewUrl((old) => {
      revokePreviewUrl(old);
      return url;
    });
    setForm((current) => ({
      ...current,
      image_file: file,
    }));
    setError(null);
  };

  const handleRemovePicture = () => {
    if (profilePictureInputRef.current) {
      profilePictureInputRef.current.value = "";
    }

    setPreviewUrl((old) => {
      revokePreviewUrl(old);
      return null;
    });
    setForm((current) => ({
      ...current,
      image_file: null,
      image_url: initialValues ? "" : current.image_url,
    }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    const first_name = form.first_name.trim();
    const last_name = form.last_name.trim();

    if (!first_name || !last_name) {
      setError("First name and last name are required.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await onSubmit({
        first_name,
        last_name,
        image_url: previewUrl || initialValues?.image_url || "",
        biography: form.biography.trim(),
        image_file: form.image_file,
      });
      setForm(emptyForm);
    } catch (err) {
      console.error("Error creating person:", err);
      setError("Failed to create person.");
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
      aria-label={mode === "edit" ? "Edit person" : "Create person"}
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
        className={`createPersonPopup relative w-[min(560px,92vw)] rounded-3xl border border-(--border1) bg-(--background1) p-6 shadow-2xl transition-all duration-200 ease-out ${
          visible ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
        }`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-xl font-semibold">
              {mode === "edit" ? "Edit person" : "Add person"}
            </h3>
            <p className="mt-2 text-sm opacity-80">
              {mode === "edit"
                ? "Update this person record. Role assignment will still be handled later on the video itself."
                : "Create a person record that can later be assigned on videos as speaker, chair, or another role."}
            </p>
          </div>
        </div>

        <form className="mt-5 flex flex-col gap-4" onSubmit={handleSubmit}>
          <span className="userPictureInput mx-auto">
            <label htmlFor="personPictureInput">
              <img
                src={previewUrl || DefaultProfile}
                alt="Profile pic"
                onError={(e) => {
                  e.currentTarget.src = DefaultProfile;
                }}
              />
              <span>{UploadSVG}</span>
            </label>

            {previewUrl && (
              <button type="button" className="remove" onClick={handleRemovePicture}>
                {CloseSVG}
              </button>
            )}

            <input
              ref={profilePictureInputRef}
              id="personPictureInput"
              type="file"
              name="personPicture"
              accept="image/jpeg,image/png,image/webp"
              onChange={handlePictureChange}
            />
          </span>

          <div className="grid grid-cols-2 gap-4 max-[640px]:grid-cols-1">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium">First name</span>
              <input
                ref={firstNameRef}
                type="text"
                value={form.first_name}
                onChange={(event) => setField("first_name", event.target.value)}
                placeholder="First name"
                className="w-full rounded-2xl border border-(--border1) bg-(--background2) px-4 py-3 outline-none transition-colors focus:border-(--accentBlue)"
                maxLength={80}
                disabled={isSubmitting}
              />
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium">Last name</span>
              <input
                type="text"
                value={form.last_name}
                onChange={(event) => setField("last_name", event.target.value)}
                placeholder="Last name"
                className="w-full rounded-2xl border border-(--border1) bg-(--background2) px-4 py-3 outline-none transition-colors focus:border-(--accentBlue)"
                maxLength={80}
                disabled={isSubmitting}
              />
            </label>
          </div>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium">Biography</span>
            <textarea
              value={form.biography}
              onChange={(event) => setField("biography", event.target.value)}
              placeholder="Short biography"
              className="min-h-36 w-full rounded-2xl border border-(--border1) bg-(--background2) px-4 py-3 outline-none transition-colors focus:border-(--accentBlue)"
              maxLength={2000}
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
              {isSubmitting
                ? mode === "edit"
                  ? "Saving..."
                  : "Creating..."
                : mode === "edit"
                  ? "Save"
                  : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

export default CreatePersonPopup;
