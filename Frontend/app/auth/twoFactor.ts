import { fetchFn } from "~/API";
import type { AuthFetchT } from "~/types";
import { getToken, redirectToLogin } from "./session";

export type TwoFactorChallenge = { success: false; requires2fa: true; twoFactorToken: string };
export type LoginResult = (AuthFetchT & { success: true }) | TwoFactorChallenge;
export type TwoFactorSetup = { success: true; qr: string; manual: { codeName: string; yourKey: string } };

export function isTwoFactorChallenge(result: LoginResult): result is TwoFactorChallenge {
  return !!result && "requires2fa" in result && result.requires2fa === true && typeof result.twoFactorToken === "string" && !!result.twoFactorToken;
}

const sessionErrors = new Set(["Unauthorized", "Missing token", "Invalid or expired token", "Authorization changed; sign in again", "User does not exist"]);
export type TwoFactorCredentials = { password: string; googleCode?: never } | { googleCode: string; password?: never };

// Failed password, Google, and OTP checks can also return HTTP 401. Only an invalid access session
// should redirect from settings; an authenticator challenge is never a session.
async function request<T>(action: "setup" | "verify" | "disable" | "login", body: object, signal?: AbortSignal): Promise<T> {
  const accessToken = action === "login" ? null : getToken();
  try {
    const result = await fetchFn<T & { success: boolean }>({
      route: `api/auth/2fa/${action}`,
      handleUnauthorizedLocally: true,
      options: {
        method: "POST", cache: "no-store", signal,
        headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify(body),
      },
    });
    if (result?.success !== true) throw new Error("Two-factor request was not confirmed");
    return result;
  } catch (error) {
    if (action !== "login" && accessToken === getToken() && error && typeof error === "object" && "status" in error && error.status === 401 && sessionErrors.has(error instanceof Error ? error.message : "")) {
      redirectToLogin(`${window.location.pathname}${window.location.search}${window.location.hash}`);
    }
    throw error;
  }
}

export const setupTwoFactor = (credentials: TwoFactorCredentials, signal?: AbortSignal) => request<TwoFactorSetup>("setup", credentials, signal);
export const verifyTwoFactor = (token: string, signal?: AbortSignal) => request<{ success: true }>("verify", { token }, signal);
export const disableTwoFactor = (credentials: TwoFactorCredentials, token: string, signal?: AbortSignal) => request<{ success: true }>("disable", { ...credentials, token }, signal);
export const loginTwoFactor = (twoFactorToken: string, otp: string, signal?: AbortSignal) => request<AuthFetchT>("login", { twoFactorToken, otp }, signal);

export function twoFactorErrorKey(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
  if (status === 429) return "twoFactorRateLimit";
  if (/google/i.test(message)) return "googleLoginRetry";
  if (message === "Invalid password") return "passwordIncorrect";
  if (message.includes("Invalid or already used") || message === "2FA token is required") return "twoFactorInvalidCode";
  if (message.includes("Sign in again")) return "twoFactorExpired";
  if (status === 409) return "twoFactorChanged";
  return "twoFactorFailed";
}
