import { Fragment, useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '~/i18n';
import styles from './durationInput.module.css';

const units = ['durationHours', 'durationMinutes', 'durationSeconds'] as const;
const weights = [3600, 60, 1];
const total = (parts: string[]) => parts.reduce((sum, part, index) => sum + Number(part || 0) * weights[index], 0);
const split = (value: number | null) => {
  const seconds = Math.max(0, Math.floor(value ?? 0));
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(part => String(part).padStart(2, '0'));
};

/** Duration in seconds; 00:00:00 emits null so the caller can choose its meaning. */
export default function DurationInput({ value, onChange, label, id, disabled = false, validationMessage = '', deferErrors = false }: {
  value: number | null; onChange: (seconds: number | null) => void; label: string; id?: string; disabled?: boolean; validationMessage?: string; deferErrors?: boolean;
}) {
  const { t } = useI18n();
  const [parts, setParts] = useState(() => split(value));
  const [interacted, setInteracted] = useState(false);
  const visibleError = !deferErrors || interacted ? validationMessage : '';
  const secondsInput = useRef<HTMLInputElement>(null), errorId = useId();
  useEffect(() => { setParts(previous => total(previous) === (value ?? 0) ? previous : split(value)); }, [value]);
  // Keep native submission validation active even while the pristine field hides its error.
  useEffect(() => { secondsInput.current?.setCustomValidity(validationMessage); }, [validationMessage]);
  const update = (index: number, raw: string) => {
    setInteracted(true);
    if (!/^\d{0,2}$/.test(raw)) return;
    const next = [...parts];
    next[index] = raw === '' ? '' : String(Math.min(index === 0 ? 99 : 59, Number(raw)));
    setParts(next);
    onChange(total(next) || null);
  };
  return <><div className={styles.control} role="group" aria-label={label} dir="ltr">
    {parts.map((part, index) => <Fragment key={units[index]}>
      {index > 0 && <span className={styles.separator} aria-hidden="true">:</span>}
      <input ref={index === 2 ? secondsInput : undefined} id={index === 0 ? id : undefined} className={styles.segment} type="text" inputMode="numeric" role="spinbutton"
        aria-label={`${label}: ${t(units[index])}`} title={t(units[index])} aria-valuemin={0} aria-valuemax={index === 0 ? Math.max(99, Number(part)) : 59}
        aria-invalid={visibleError ? true : undefined} aria-describedby={visibleError ? errorId : undefined}
        aria-valuenow={Number(part || 0)} maxLength={2} autoComplete="off" value={part} disabled={disabled}
        onFocus={event => event.currentTarget.select()}
        onInvalid={event => { event.preventDefault(); setInteracted(true); secondsInput.current?.focus(); }}
        onChange={event => update(index, event.target.value)}
        onBlur={() => setParts(previous => previous.map(segment => String(Number(segment || 0)).padStart(2, '0')))}
        onKeyDown={event => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
          event.preventDefault();
          update(index, String(Math.max(0, Math.min(index === 0 ? 99 : 59, Number(part || 0) + (event.key === 'ArrowUp' ? 1 : -1)))));
        }} />
    </Fragment>)}
  </div>{visibleError && <p id={errorId} className={styles.error} role="alert">{visibleError}</p>}</>;
}
