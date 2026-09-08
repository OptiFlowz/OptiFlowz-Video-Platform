import { env } from "./env";

export const SERVER_REACHABILITY_TIMEOUT_MS = 4500;

export async function checkServerReachability(signal?: AbortSignal) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), SERVER_REACHABILITY_TIMEOUT_MS);

  const abortHandler = () => controller.abort();
  signal?.addEventListener("abort", abortHandler);
  if (signal?.aborted) controller.abort();

  try {
    const response = await fetch(`${env.apiBaseUrl}/health`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });

    return response.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abortHandler);
  }
}
