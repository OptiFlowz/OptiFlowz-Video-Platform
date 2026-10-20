import { fetchFn } from '~/API';
import { getToken } from '~/functions';
import type { Listing, PageInfo } from './model';
export const engineKey = ['quiz-engine'] as const;
export async function request<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const result = await fetchFn<T & { success?: boolean; message?: string }>({
    route: `api/quizzes${path}`, options: { method, signal, cache: 'no-store',
      headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    },
  });
  if (result?.success === false) throw new Error(result.message || 'Request failed');
  return result;
}
export async function list<T>(path: string, key: string, params: Record<string, string | number> = {}, signal?: AbortSignal): Promise<Listing<T>> {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== '').map(([name, value]) => [name, String(value)]));
  const response = await request<Record<string, unknown>>(`${path}${path.includes("?") ? "&" : "?"}${query}`, 'GET', undefined, signal);
  if (!Array.isArray(response[key]) || !response.pagination) throw new Error('Invalid list response');
  return { items: response[key] as T[], pagination: response.pagination as PageInfo };
}
// Replacement writes and readiness checks must never silently truncate a list at 100 rows.
export async function all<T>(path: string, key: string, params: Record<string, string | number> = {}, signal?: AbortSignal): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; ; page++) {
    const result = await list<T>(path, key, { ...params, page, limit: 100 }, signal);
    rows.push(...result.items);
    if (!result.pagination.hasNextPage) return rows;
    if (!result.items.length) throw new Error('Incomplete list response');
  }
}
