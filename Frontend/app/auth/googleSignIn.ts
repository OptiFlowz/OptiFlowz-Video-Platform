import { fetchFn } from "~/API";
import type { AuthFetchT } from "~/types";
import { consumeGoogleAttempt } from "./googleOAuth";
import { saveSession } from "./session";
import { isTwoFactorChallenge, type LoginResult, type TwoFactorChallenge } from "./twoFactor";

type SignIn = { redirect: string; remember: boolean; completion: Promise<TwoFactorChallenge | void> };
let activeSignIn: { callback: string; result: SignIn } | undefined;

export function finishGoogleSignIn(session: AuthFetchT, remember: boolean, redirect: string) {
  // Session notification can remount the callback before navigation. Clear the
  // challenge first, keeping a settled exchange so the Google code isn't reused.
  if (activeSignIn) activeSignIn.result.completion = Promise.resolve();
  saveSession(session, remember);
  localStorage.autoplay = "true";
  window.location.replace(redirect);
}

export function cancelGoogleSignIn(redirect: string) {
  activeSignIn = undefined;
  window.location.replace(`/login?redirect=${encodeURIComponent(redirect)}`);
}

export function completeGoogleSignIn(params: URLSearchParams): SignIn {
  const callback = params.toString();
  if (activeSignIn?.callback === callback) return activeSignIn.result;

  const attempt = consumeGoogleAttempt(params.get("state"));
  const code = params.get("code");
  const result: SignIn = {
    redirect: attempt?.redirect ?? "/",
    remember: attempt?.remember ?? false,
    completion: (async () => {
      if (!attempt || !code || params.has("error")) throw new Error("Invalid Google sign-in attempt");
      const response = await fetchFn<LoginResult>({
        route: "api/auth/oauth/google",
        options: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) },
      });
      if (isTwoFactorChallenge(response)) return response;
      if (!response || response.success !== true || !("token" in response) || !response.token || !response.user) throw new Error("Missing session");
      finishGoogleSignIn(response, attempt.remember, attempt.redirect);
    })(),
  };
  activeSignIn = { callback, result };
  return result;
}
