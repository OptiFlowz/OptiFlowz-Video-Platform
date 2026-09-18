import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { fetchFn } from "~/API";
import { getToken, updateStoredProfile } from "~/auth/session";
import { setupTwoFactor, verifyTwoFactor, disableTwoFactor, twoFactorErrorKey, type TwoFactorSetup, type TwoFactorCredentials } from "~/auth/twoFactor";
import type { AuthFetchT } from "~/types";
import { useI18n } from "~/i18n";
import Loader from "~/components/loaders/loader";
import { requestGoogleReauthentication, GoogleReauthenticationError } from "~/auth/googleReauthentication";
import { TwoFactorShieldSVG, GoogleSVG } from "~/constants";

export default function TwoFactorSettings({ resetPasswordUrl }: { resetPasswordUrl: string }) {
  const { t } = useI18n();
  const id = useId();
  const token = getToken();
  const client = useQueryClient();
  const [step, setStep] = useState<"idle" | "setup" | "verify" | "disable">("idle");
  const [password, setPassword] = useState("");
  const [googleCode, setGoogleCode] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const profile = useQuery({
    queryKey: ["accountInfo", token],
    queryFn: ({ signal }) => fetchFn<AuthFetchT>({ route: "api/auth/me", options: { method: "GET", cache: "no-store", headers: { Authorization: `Bearer ${token}` }, signal } }),
    enabled: !!token, staleTime: 0, refetchOnMount: "always", refetchOnWindowFocus: false, retry: false,
  });
  const enabled = profile.data?.user?.is_2fa_enabled;
  const loginMethods = profile.data?.user?.login_methods;
  const preferGoogle = loginMethods?.google === true;
  const statusReady = typeof enabled === "boolean" && !profile.isError && (preferGoogle || loginMethods?.password === true);
  const needsGoogle = step !== "verify" && preferGoogle && !googleCode;
  const resetForm = () => {
    setGoogleCode(""); setPassword(""); setCode(""); setSetup(null); setError(""); setStep("idle");
  };

  return <div className="twoFactorSettings">
    <div className="settingsRow">
      <div className="settingsRowText"><h3>{t("twoFactorTitle")}</h3><p>{t("twoFactorHelp")}</p>
        {statusReady && <span className={`twoFactorStatus ${enabled ? "enabled" : "disabled"}`} role="status" aria-live="polite" aria-atomic="true">{TwoFactorShieldSVG}{t(enabled ? "twoFactorEnabled" : "twoFactorDisabled")}</span>}
      </div>
      <button type="button" className="accountSettingsAction" disabled={!statusReady || profile.isFetching || busy || step !== "idle"} onClick={() => { setError(""); setStep(enabled ? "disable" : "setup"); }}>{t(enabled ? "twoFactorDisable" : "twoFactorEnable")}</button>
    </div>
    {profile.isFetching && !statusReady && <div role="status" className="twoFactorLoading"><Loader classes="twoFactorSpinner" /><span>{t("twoFactorLoading")}</span></div>}
    {!profile.isFetching && !statusReady && <div className="twoFactorError" role="alert"><p>{t("twoFactorFailed")}</p><button type="button" className="accountSettingsAction" onClick={() => void profile.refetch()}>{t("usersRetry")}</button></div>}
    {step !== "idle" && <form className="twoFactorForm twoFactorPanel" aria-busy={busy} onSubmit={async event => {
      event.preventDefault();
      if (pending.current || !token) return;
      if (step !== "verify" && !preferGoogle && !password) return;
      if (step !== "setup" && !needsGoogle && !/^\d{6}$/.test(code)) return;
      pending.current = true; setBusy(true); setError("");
      const controller = new AbortController();
      request.current = controller;
      try {
        let credentials: TwoFactorCredentials = preferGoogle ? { googleCode } : { password };
        if (needsGoogle) {
          const freshCode = await requestGoogleReauthentication(profile.data?.user?.email ?? "", controller.signal);
          if (controller.signal.aborted || getToken() !== token) return;
          if (step === "disable") {
            setGoogleCode(freshCode);
            setCode("");
            return;
          }
          credentials = { googleCode: freshCode };
        }
        if (controller.signal.aborted || getToken() !== token) return;
        if (step === "setup") {
          const result = await setupTwoFactor(credentials, controller.signal);
          if (!result.qr?.startsWith("data:image/png;base64,") || !result.manual?.yourKey) throw new Error("Incomplete setup");
          if (controller.signal.aborted) return;
          setPassword(""); setSetup(result); setStep("verify");
        } else {
          const nextEnabled = step === "verify";
          if (nextEnabled) await verifyTwoFactor(code, controller.signal);
          else await disableTwoFactor(credentials, code, controller.signal);
          if (controller.signal.aborted || getToken() !== token) return;
          await client.cancelQueries({ queryKey: ["accountInfo", token], exact: true });
          if (controller.signal.aborted || getToken() !== token) return;
          client.setQueryData<AuthFetchT>(["accountInfo", token], current => {
            if (!current?.user) return current;
            const user = { ...current.user, is_2fa_enabled: nextEnabled };
            updateStoredProfile(user, token);
            return { ...current, user };
          });
          resetForm();
        }
      } catch (failure) {
        if (!controller.signal.aborted) {
          if (failure instanceof GoogleReauthenticationError && failure.cancelled) return;
          setGoogleCode("");
          setError(failure instanceof GoogleReauthenticationError ? "googleLoginRetry" : twoFactorErrorKey(failure)); setCode("");
          if (failure && typeof failure === "object" && "status" in failure && failure.status === 409) {
            setSetup(null); setPassword(""); setStep("idle"); void profile.refetch();
          }
        }
      } finally {
        pending.current = false;
        if (!controller.signal.aborted) setBusy(false);
      }
    }}>
      <h3>{t(step === "disable" ? "twoFactorDisable" : "twoFactorEnable")}</h3>
      {needsGoogle && <p>{t("twoFactorGoogleHelp")}</p>}
      {step === "disable" && preferGoogle && googleCode && <p>{t("twoFactorCodeHelp")}</p>}
      {step !== "verify" && !preferGoogle && <>
        <p>{t("twoFactorPasswordHelp")} <Link to={resetPasswordUrl}>{t("resetPassword")}</Link></p>
        <label htmlFor={`${id}-password`}>{t("password")}
          <input autoFocus id={`${id}-password`} name="current-password" type="password" autoComplete="current-password" maxLength={1024} value={password} onChange={event => setPassword(event.target.value)} required disabled={busy} />
        </label>
      </>}
      {step === "verify" && setup && <>
        <p>{t("twoFactorScanHelp")}</p>
        <img className="twoFactorQr" src={setup.qr} alt={t("twoFactorTitle")} />
        <details className="twoFactorManual"><summary>{t("twoFactorManual")}</summary><p dir="auto">{setup.manual.codeName}</p><code dir="ltr">{setup.manual.yourKey}</code></details>
      </>}
      {step !== "setup" && !needsGoogle && <label htmlFor={`${id}-code`}>{t("twoFactorCode")}
        <input key={step} autoFocus={step === "verify" || preferGoogle} id={`${id}-code`} className="twoFactorCode" name="otp" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} required disabled={busy} />
      </label>}
      {error && <p role="alert" className="twoFactorError">{t(error)}</p>}
      <div className="twoFactorActions">
        <button type="button" className="button twoFactorSecondary" disabled={busy} onClick={resetForm}>{t("cancel")}</button>
        <button type="submit" className="button twoFactorPrimary" disabled={busy || (step !== "verify" && !preferGoogle && !password) || (step !== "setup" && !needsGoogle && code.length !== 6)}>{busy ? <Loader classes="twoFactorSpinner" /> : needsGoogle ? <span className="twoFactorGoogleIcon">{GoogleSVG}</span> : null}{t(needsGoogle ? "continueWithGoogle" : step === "setup" ? "quizContinue" : step === "verify" ? "twoFactorVerify" : "twoFactorDisable")}</button>
      </div>
    </form>}
    {step === "idle" && error && <p role="alert" className="twoFactorError">{t(error)}</p>}
  </div>;
}
