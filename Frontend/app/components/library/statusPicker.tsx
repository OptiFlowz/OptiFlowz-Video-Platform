import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CheckSVG } from "~/constants";
import { createPortal } from "react-dom";
import { useI18n } from "~/i18n";
import "./statusPicker.css";

type Props<Value extends string> = {
  value: Value;
  title: string;
  options: ReadonlyArray<{ value: Value; label: string; icon: ReactNode }>;
  disabled?: boolean;
  className?: string;
  onSave: (value: Value) => Promise<void> | void;
};

export default function StatusPicker<Value extends string>({ value, title, options, disabled, className = "managementStatus", onSave }: Props<Value>) {
  const { t } = useI18n();
  const radioName = useId();
  const selected = options.find(option => option.value === value);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const savingRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open) return;
    const popup = dialog.current;
    if (!popup) return;
    const position = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = popup.offsetWidth;
      const height = popup.offsetHeight;
      const mobile = window.innerWidth <= 640;
      popup.style.left = `${mobile ? (window.innerWidth - width) / 2 : Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
      popup.style.top = `${mobile ? window.innerHeight - height - 12 : Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - height - 12))}px`;
    };
    popup.showModal();
    position();
    const observer = new ResizeObserver(position);
    observer.observe(popup);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      popup.close();
      trigger.current?.focus({ preventScroll: true });
    };
  }, [open]);

  async function save() {
    if (savingRef.current) return;
    if (draft === value) { setOpen(false); return; }
    savingRef.current = true;
    setSaving(true);
    setError(false);
    try {
      await onSave(draft);
      setOpen(false);
    } catch {
      setError(true);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return <>
    <button ref={trigger} type="button" disabled={disabled}
      className={`statusPickerTrigger ${className}`}
      aria-label={`${title}: ${selected?.label ?? value}`}
      aria-haspopup="dialog" aria-expanded={open}
      onClick={() => { setDraft(value); setError(false); setOpen(true); }}>
      {selected?.icon}
      {selected?.label ?? value}
    </button>
    {open && createPortal(<dialog ref={dialog} className="statusPickerPopup"
      aria-label={`${t("adminTableStatus")}: ${title}`} aria-busy={saving}
      onCancel={event => { event.preventDefault(); if (!savingRef.current) setOpen(false); }}
      onClick={event => {
        if (event.target !== event.currentTarget || savingRef.current) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) setOpen(false);
      }}>
      <fieldset disabled={saving}>
        <legend className="sr-only">{t("adminTableStatus")}</legend>
        {options.map(option => <label key={option.value}>
          <span className="statusPickerRadio">
            <input type="radio" name={radioName} checked={draft === option.value} onChange={() => setDraft(option.value)} />
            <span className="statusPickerRadioVisual" aria-hidden="true">{draft === option.value && CheckSVG}</span>
          </span>
          {option.icon}
          <span>{option.label}</span>
        </label>)}
      </fieldset>
      {error && <p role="alert" className="statusPickerError">{t("errorUnexpected")}</p>}
      <div className="statusPickerActions">
        <button type="button" disabled={saving} onClick={() => setOpen(false)}>{t("adminCancel")}</button>
        <button type="button" className="statusPickerSave" disabled={saving} onClick={() => void save()}>{saving && <span className="uploadSpinner tiny" />}{t("adminSave")}</button>
      </div>
    </dialog>, document.body)}
  </>;
}
