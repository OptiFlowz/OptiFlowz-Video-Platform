import "server-only";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ||
  process.env.VITE_FIRST?.replace(/\/$/, "") ||
  "";

export async function fetchPublicApi<T>(route: string): Promise<T | null> {
  if (!API_BASE_URL) return null;

  try {
    const response = await fetch(`${API_BASE_URL}/${route.replace(/^\//, "")}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 300 },
    });

    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export const jsonLd = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

export const toIsoDuration = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;

  return `PT${hours ? `${hours}H` : ""}${minutes ? `${minutes}M` : ""}${remainingSeconds || (!hours && !minutes) ? `${remainingSeconds}S` : ""}`;
};
