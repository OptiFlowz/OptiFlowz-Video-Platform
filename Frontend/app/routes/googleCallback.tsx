import { useEffect, useState } from "react";
import { Link } from "react-router";
import Loader from "~/components/loaders/loader";
import { completeGoogleSignIn } from "~/auth/googleSignIn";
import { useI18n } from "~/i18n";

export default function GoogleCallbackPage() {
  const { t } = useI18n();
  const [error, setError] = useState(false);
  const [returnPath, setReturnPath] = useState("/");

  useEffect(() => {
    let mounted = true;
    const signIn = completeGoogleSignIn(new URLSearchParams(window.location.search));
    setReturnPath(signIn.redirect);
    void signIn.completion.catch(() => { if (mounted) setError(true); });
    return () => { mounted = false; };
  }, []);

  return <main className="login fixed! inset-0 w-[100vw]! h-[100vh]! p-0!">
    {error ? <div role="alert" className="flex flex-col items-center justify-center gap-4 p-6 text-(--text1)">
      <p>{t("googleLoginRetry")}</p>
      <Link to={`/login?redirect=${encodeURIComponent(returnPath)}`} className="button bg-(--background2) hover:bg-(--background3) rounded-full px-5 py-3">{t("login")}</Link>
    </div> : <Loader classes="pageLoader show" />}
  </main>;
}
