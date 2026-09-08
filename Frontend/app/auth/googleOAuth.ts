import { safeRedirect } from "./safeRedirect";

const ATTEMPT_KEY = "optiflowz-google-attempt";
const MAX_AGE_MS = 10 * 60 * 1000;
type GoogleAttempt = { state: string; redirect: string; remember: boolean; createdAt: number };

export function startGoogleAttempt(redirect: string, remember: boolean): string {
  const state = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
  const attempt: GoogleAttempt = { state, redirect: safeRedirect(redirect), remember, createdAt: Date.now() };
  sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify(attempt));
  return state;
}

export function consumeGoogleAttempt(state: string | null): GoogleAttempt | null {
  try {
    const raw = sessionStorage.getItem(ATTEMPT_KEY);
    if (!raw || !state) return null;
    const attempt = JSON.parse(raw) as GoogleAttempt;
    if (attempt.state !== state) return null;
    sessionStorage.removeItem(ATTEMPT_KEY);
    const age = Date.now() - attempt.createdAt;
    if (!Number.isFinite(age) || age < 0 || age > MAX_AGE_MS || typeof attempt.remember !== "boolean") return null;
    return { ...attempt, redirect: safeRedirect(attempt.redirect) };
  } catch { return null; }
}
