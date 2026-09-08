import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Link } from "react-router";
import { fetchFn } from "~/API";
import Loader from "~/components/loaders/loader";
import type { AuthFetchT } from "~/types";
import { saveSession } from "~/auth/session";
import { consumeGoogleAttempt } from "~/auth/googleOAuth";
import { useI18n } from "~/i18n";

export default function GoogleCallbackPage() {
  const router = useRouter();
  const { t } = useI18n();
  const started = useRef(false);
  const [error, setError] = useState(false);
  const [returnPath, setReturnPath] = useState("/");

  useEffect(() => {
    // Code exchange is single-use, including React's development effect replay.
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    const attempt = consumeGoogleAttempt(params.get("state"));
    const code = params.get("code");
    if (!attempt) { setError(true); return; }
    setReturnPath(attempt.redirect);
    if (!code || params.has("error")) { setError(true); return; }

    void fetchFn<AuthFetchT>({
      route: "api/auth/oauth/google",
      options: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) },
    }).then(response => {
      if (!response?.token) throw new Error("Missing session");
      saveSession(response, attempt.remember);
      localStorage.autoplay = "true";
      window.location.replace(attempt.redirect);
    }).catch(() => setError(true));
  }, [router]);

  return <main className="login fixed! inset-0 w-[100vw]! h-[100vh]! p-0!">
    {error ? <div role="alert" className="flex flex-col items-center justify-center gap-4 p-6 text-(--text1)">
      <p>{t("googleLoginRetry")}</p>
      <Link to={`/login?redirect=${encodeURIComponent(returnPath)}`} className="button bg-(--background2) hover:bg-(--background3) rounded-full px-5 py-3">{t("login")}</Link>
    </div> : <Loader classes="pageLoader show" />}
  </main>;
}
