import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "~/i18n";
import type { AuthFetchT } from "~/types";
import { loginTwoFactor, twoFactorErrorKey } from "~/auth/twoFactor";
import Loader from "~/components/loaders/loader";

export default function TwoFactorLoginForm({ challenge, onComplete, onBack }: {
  challenge: string;
  onComplete: (session: AuthFetchT) => void;
  onBack: () => void;
}) {
  const { t } = useI18n();
  const codeId = useId();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(false);
  const pending = useRef(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setExpired(true), 5 * 60 * 1000);
    return () => { window.clearTimeout(timer); request.current?.abort(); };
  }, [challenge]);

  return <form className="twoFactorForm" aria-busy={busy} onSubmit={async event => {
    event.preventDefault();
    if (pending.current || expired || !/^\d{6}$/.test(code)) return;
    pending.current = true;
    setBusy(true);
    setError("");
    const controller = new AbortController();
    request.current = controller;
    try {
      const session = await loginTwoFactor(challenge, code, controller.signal);
      if (!session.token || !session.user) throw new Error("Missing session");
      if (!controller.signal.aborted) onComplete(session);
    } catch (failure) {
      if (controller.signal.aborted) return;
      const key = twoFactorErrorKey(failure);
      setError(key);
      setCode("");
      if (key === "twoFactorExpired") setExpired(true);
      pending.current = false;
      setBusy(false);
    }
  }}>
    <h1>{t("twoFactorTitle")}</h1>
    <p>{t("twoFactorCodeHelp")}</p>
    {!expired && <label htmlFor={codeId}>{t("twoFactorCode")}
      <input id={codeId} name="otp" className="twoFactorCode" autoFocus type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required value={code} disabled={busy} onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} aria-invalid={!!error} aria-describedby={error ? `${codeId}-error` : undefined} />
    </label>}
    {(expired || error) && <p id={`${codeId}-error`} role="alert" className="twoFactorError">{t(expired ? "twoFactorExpired" : error)}</p>}
    <div className="twoFactorActions">
      <button type="button" className="button twoFactorSecondary" disabled={busy} onClick={onBack}>{t("back")}</button>
      {!expired && <button type="submit" className="button twoFactorPrimary" disabled={busy || code.length !== 6}>{busy && <Loader classes="twoFactorSpinner" />}{t(busy ? "loggingIn" : "twoFactorVerify")}</button>}
    </div>
  </form>;
}
