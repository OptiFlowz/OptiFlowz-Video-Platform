import { env } from "./env";
import { clearSession, getToken } from "./auth/session";
import { safeRedirect } from "./auth/safeRedirect";

type Props = {
    route: string,
    options: RequestInit
}

class FetchError extends Error {
  status: number;
  body?: any;
  constructor(status: number, message: string, body?: any) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function fetchFn<T>(props: Props): Promise<T> {
  const requestToken = new Headers(props.options.headers).get("Authorization")?.replace(/^Bearer\s+/i, "");
  const res = await fetch(`${env.apiBaseUrl}/${props.route}`, props.options);
  const body = await res.json().catch(() => null);

  if (res.status === 401) {
    // An old request must never sign out a newer session, nor should a public 401.
    if (typeof window !== "undefined" && requestToken && requestToken === getToken()) {
      const target = safeRedirect(`${window.location.pathname}${window.location.search}${window.location.hash}`);
      clearSession();
      if (window.location.pathname !== "/login") window.location.replace(`/login?redirect=${encodeURIComponent(target)}`);
    }
    throw new FetchError(401, body?.message ?? "Unauthorized", body);
  }

  if (!res.ok) {
    throw new FetchError(res.status, body?.message ?? `HTTP error: ${res.status}`, body);
  }

  return body as T;
}
