import { env } from "~/env";

const STATE_PREFIX = "two-factor-";
const MESSAGE_TYPE = "two-factor-google-code";

export class GoogleReauthenticationError extends Error {
  constructor(public cancelled = false) {
    super("Google reauthentication was not completed");
  }
}

// A fresh code is used only by the 2FA endpoint, never by the normal login flow.
export function requestGoogleReauthentication(email: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted || !env.googleClientId) {
      reject(new GoogleReauthenticationError(signal.aborted));
      return;
    }
    const state = STATE_PREFIX + Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
    const params = new URLSearchParams({
      client_id: env.googleClientId,
      redirect_uri: `${window.location.origin}/google-callback`,
      response_type: "code",
      scope: "openid email profile",
      prompt: "select_account",
      login_hint: email,
      state,
    });
    const popup = window.open("about:blank", "_blank", "popup,width=520,height=680");
    if (!popup) {
      reject(new GoogleReauthenticationError());
      return;
    }
    let settled = false;
    let closeTimer: number | undefined;
    const finish = (code?: string, cancelled = false) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", receive);
      signal.removeEventListener("abort", abort);
      window.clearInterval(closedPoll);
      window.clearTimeout(timeout);
      window.clearTimeout(closeTimer);
      popup.close();
      if (code) resolve(code);
      else reject(new GoogleReauthenticationError(cancelled));
    };
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== popup || event.data?.type !== MESSAGE_TYPE || event.data.state !== state) return;
      finish(typeof event.data.code === "string" ? event.data.code : undefined, event.data.error === "access_denied");
    };
    const abort = () => finish(undefined, true);
    const closedPoll = window.setInterval(() => {
      if (popup.closed && closeTimer === undefined) {
        // Give the callback's queued message time to arrive before treating closure as cancellation.
        closeTimer = window.setTimeout(() => finish(undefined, true), 500);
      }
    }, 500);
    const timeout = window.setTimeout(() => finish(), 10 * 60 * 1000);
    window.addEventListener("message", receive);
    signal.addEventListener("abort", abort, { once: true });
    try {
      popup.location.replace(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
    } catch {
      finish();
    }
  });
}

export function completeGoogleReauthentication(params: URLSearchParams): boolean {
  const state = params.get("state");
  if (!state?.startsWith(STATE_PREFIX)) return false;
  // The opener validates the source window and the full random state. This
  // callback must never exchange a reauthentication code for a new login session.
  if (window.opener) {
    window.opener.postMessage({ type: MESSAGE_TYPE, state, code: params.get("error") ? null : params.get("code"), error: params.get("error") }, window.location.origin);
  }
  window.close();
  return true;
}
