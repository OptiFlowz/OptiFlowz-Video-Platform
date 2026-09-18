import { useEffect, useState } from "react";
import { Link } from "react-router";
import Loader from "~/components/loaders/loader";
import TwoFactorLoginForm from "~/components/loginPage/twoFactorLoginForm";
import { completeGoogleSignIn, finishGoogleSignIn, cancelGoogleSignIn } from "~/auth/googleSignIn";
import { completeGoogleReauthentication } from "~/auth/googleReauthentication";
import { useI18n } from "~/i18n";

export default function GoogleCallbackPage() {
  const { t } = useI18n();
  const [error, setError] = useState(false);
  const [returnPath, setReturnPath] = useState("/");
  const [pending, setPending] = useState<{ token: string; remember: boolean } | null>(null);

  useEffect(() => {
    if (completeGoogleReauthentication(new URLSearchParams(window.location.search))) return;
    let mounted = true;
    const signIn = completeGoogleSignIn(new URLSearchParams(window.location.search));
    setReturnPath(signIn.redirect);
    void signIn.completion.then(challenge => {
      if (mounted && challenge) setPending({ token: challenge.twoFactorToken, remember: signIn.remember });
    }).catch(() => { if (mounted) setError(true); });
    return () => { mounted = false; };
  }, []);

  return <main className="login twoFactorCallback">
    {pending ? <div className="twoFactorCallbackCard"><TwoFactorLoginForm challenge={pending.token}
      onComplete={session => { setPending(null); finishGoogleSignIn(session, pending.remember, returnPath); }}
      onBack={() => { setPending(null); cancelGoogleSignIn(returnPath); }} />
    </div> : error ? <div role="alert" className="twoFactorCallbackCard">
      <p>{t("googleLoginRetry")}</p>
      <Link to={`/login?redirect=${encodeURIComponent(returnPath)}`} className="twoFactorSecondary">{t("login")}</Link>
    </div> : <Loader classes="pageLoader show" />}
  </main>;
}
