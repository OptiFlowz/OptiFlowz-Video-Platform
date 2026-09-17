import { fetchFn } from "~/API";
import type { AuthFetchT } from "~/types";
import { consumeGoogleAttempt } from "./googleOAuth";
import { saveSession } from "./session";

type SignIn = { redirect: string; completion: Promise<void> };
let activeSignIn: { callback: string; result: SignIn } | undefined;

export function completeGoogleSignIn(params: URLSearchParams): SignIn {
  const callback = params.toString();
  // saveSession remounts the session tree before browser navigation completes.
  // Keep the single-use exchange outside that tree, including its settled result.
  if (activeSignIn?.callback === callback) return activeSignIn.result;

  const attempt = consumeGoogleAttempt(params.get("state"));
  const code = params.get("code");
  const result: SignIn = {
    redirect: attempt?.redirect ?? "/",
    completion: (async () => {
      if (!attempt || !code || params.has("error")) throw new Error("Invalid Google sign-in attempt");
      const response = await fetchFn<AuthFetchT>({
        route: "api/auth/oauth/google",
        options: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) },
      });
      if (!response?.token) throw new Error("Missing session");
      saveSession(response, attempt.remember);
      localStorage.autoplay = "true";
      window.location.replace(attempt.redirect);
    })(),
  };
  activeSignIn = { callback, result };
  return result;
}
