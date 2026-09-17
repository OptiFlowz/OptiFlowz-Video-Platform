import { env } from "./env";
import { clearSession, getToken, redirectToLogin } from "./auth/session";

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

/** Backend requests share 401 handling regardless of endpoint or response format. */
export async function fetchApiResponse(url: string, options: RequestInit = {}): Promise<Response> {
  const sessionToken = getToken();
  const requestToken = new Headers(options.headers).get("Authorization")?.replace(/^Bearer\s+/i, "");
  const res = await fetch(url, options);

  if (res.status === 401) {
    const currentToken = getToken();
    // Ignore stale failures from requests belonging to a previous session.
    const sameSession = sessionToken === currentToken && (!requestToken || requestToken === currentToken);
    if (typeof window !== "undefined" && sameSession) {
      const { pathname, search, hash } = window.location;
      // A failed login stays on the form so it can display invalid credentials.
      if (pathname !== "/login") redirectToLogin(`${pathname}${search}${hash}`);
      else if (currentToken) clearSession();
    }
    const body = await res.json().catch(() => null);
    throw new FetchError(401, body?.message ?? "Unauthorized", body);
  }

  return res;
}

export async function fetchFn<T>(props: Props): Promise<T> {
  const res = await fetchApiResponse(`${env.apiBaseUrl}/${props.route}`, props.options);
  const body = await res.json().catch(() => null);

  if (!res.ok) {
    throw new FetchError(res.status, body?.message ?? `HTTP error: ${res.status}`, body);
  }

  return body as T;
}
