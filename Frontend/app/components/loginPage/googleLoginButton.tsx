import { useState } from "react";
import { GoogleSVG } from "~/constants";
import { env } from "~/env";
import { useI18n } from "~/i18n";
import { startGoogleAttempt } from "~/auth/googleOAuth";

type Props = { props: { isLoading: boolean; rememberMe: boolean; redirect: string } };

export default function GoogleLoginButton({ props }: Props) {
  const { t } = useI18n();
  const [starting, setStarting] = useState(false);
  const [failed, setFailed] = useState(false);

  const handleSubmit = () => {
    if (starting || props.isLoading || !env.googleClientId) return;
    setStarting(true);
    setFailed(false);
    try {
      const state = startGoogleAttempt(props.redirect, props.rememberMe);
      const params = new URLSearchParams({
        client_id: env.googleClientId,
        redirect_uri: `${window.location.origin}/google-callback`,
        response_type: "code",
        scope: "openid email profile",
        state,
      });
      window.location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
    } catch {
      setStarting(false);
      setFailed(true);
    }
  };

  return <>
    <button type="button" disabled={props.isLoading || starting || !env.googleClientId} onClick={handleSubmit}
      className="button bg-(--background2) border-1! text-(--text1) border-(--border1)! w-full rounded-[12px] py-3 font-semibold mt-1 hover:bg-(--background3) disabled:opacity-60 disabled:cursor-not-allowed">
      {props.isLoading || starting ? t("loggingIn") : <span className="loginButton font-medium flex items-center justify-center gap-2">{GoogleSVG}<span>{t("continueWithGoogle")}</span></span>}
    </button>
    {(failed || !env.googleClientId) && <p role="alert">{t("googleLoginUnavailable")}</p>}
  </>;
}
