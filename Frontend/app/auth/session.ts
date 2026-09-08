import type { AuthFetchT } from "../types";

const SESSION_EVENT = "optiflowz-session-change";

export function getStoredUser(): AuthFetchT | null {
  if (typeof window === "undefined") return null;
  for (const storage of [sessionStorage, localStorage]) {
    const raw = storage.getItem("user");
    if (!raw) continue;
    try {
      const session = JSON.parse(raw);
      if (typeof session?.token === "string" && session.token && session.user && typeof session.user === "object") {
        return session as AuthFetchT;
      }
    } catch { /* Ignore invalid or obsolete stored sessions. */ }
  }
  return null;
}

export const getToken = (): string | null => getStoredUser()?.token ?? null;

export function saveSession(session: AuthFetchT, remember: boolean) {
  if (!session.token) return;
  localStorage.removeItem("user");
  sessionStorage.removeItem("user");
  localStorage.setItem("rememberMe", String(remember));
  (remember ? localStorage : sessionStorage).setItem("user", JSON.stringify(session));
  window.dispatchEvent(new Event(SESSION_EVENT));
}

export function clearSession() {
  localStorage.removeItem("user");
  sessionStorage.removeItem("user");
  localStorage.removeItem("rememberMe");
  localStorage.removeItem("optiflowzQuizReturnPath");
  window.dispatchEvent(new Event(SESSION_EVENT));
}

export function updateStoredProfile(user: AuthFetchT["user"], expectedToken: string) {
  const session = getStoredUser();
  if (!session || session.token !== expectedToken) return;
  let storage = localStorage;
  try {
    if (JSON.parse(sessionStorage.getItem("user") ?? "null")?.token === expectedToken) storage = sessionStorage;
  } catch { /* The valid session was found in localStorage. */ }
  storage.setItem("user", JSON.stringify({ ...session, user }));
}

export function subscribeToSession(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === "user" || event.key === null) onChange();
  };
  window.addEventListener(SESSION_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(SESSION_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}
