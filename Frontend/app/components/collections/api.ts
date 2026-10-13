import { fetchFn } from '~/API';
import { getToken } from '~/functions';
import type { Collection, CollectionDetails, CollectionFields, CollectionsResult, CollectionSort } from './model';
import { collectionFields } from './model';
import type { VideoPlaylistT } from '~/types';

function request<T>(route: string, method = 'GET', body?: unknown, signal?: AbortSignal) {
  const token = getToken();
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const multipart = typeof FormData !== 'undefined' && body instanceof FormData;
  if (body !== undefined && !multipart) headers['Content-Type'] = 'application/json';
  return fetchFn<T>({ route, options: { method, headers, signal,
    ...(body === undefined ? {} : { body: multipart ? body as FormData : JSON.stringify(body) }) } });
}
export function getCollections({ userId, page, limit, title = '', sortBy = 'created_at', sortOrder = 'desc', visibility }: {
  userId?: string; page: number; limit: number; title?: string; sortBy?: CollectionSort;
  sortOrder?: 'asc' | 'desc'; visibility?: 'public' | 'private';
}, signal?: AbortSignal) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit), sortBy, sortOrder });
  if (userId) params.set('userId', userId);
  if (title.trim()) params.set('title', title.trim());
  if (visibility) params.set('visibility', visibility);
  return request<CollectionsResult>(`api/collections?${params}`, 'GET', undefined, signal);
}
export const getCollection = (id: string, signal?: AbortSignal) => request<CollectionDetails>(`api/collections/${encodeURIComponent(id)}`, 'GET', undefined, signal);
export const createCollection = (fields: CollectionFields) => request<{ collection: Collection }>('api/collections', 'POST', collectionFields(fields));
export const updateCollection = (id: string, fields: CollectionFields) => request<{ collection: Collection }>(`api/collections/${encodeURIComponent(id)}`, 'PATCH', collectionFields(fields));
export const updateCollectionVisibility = (id: string, visibility: Collection['visibility']) => request<{ collection: Collection }>(`api/collections/${encodeURIComponent(id)}`, 'PATCH', { visibility });
export const deleteCollection = (id: string) => request(`api/collections/${encodeURIComponent(id)}`, 'DELETE');
export const addPlaylists = (id: string, ids: string[]) => request(`api/collections/${encodeURIComponent(id)}/playlists`, 'POST', { playlist_ids: ids });
export const removePlaylist = (id: string, playlistId: string) => request(`api/collections/${encodeURIComponent(id)}/playlists/${encodeURIComponent(playlistId)}`, 'DELETE');
export const savePlaylistOrder = (id: string, ids: string[]) => request(`api/collections/${encodeURIComponent(id)}/playlists/reorder`, 'PATCH', { playlist_ids: ids });
export function uploadThumbnail(id: string, file?: File) {
  const form = new FormData(); if (file) form.append('file', file);
  return request<{ collection: Collection }>(`api/collections/${encodeURIComponent(id)}/thumbnail`, 'POST', form);
}
export async function findCollectionPlaylists(scope: 'mine' | 'public', search: string, page: number, signal?: AbortSignal) {
  const params = new URLSearchParams({ page: String(page), limit: '10', q: search });
  if (scope === 'mine') {
    params.set('sort', 'created_at'); params.set('order', 'desc');
    const data = await request<{ playlists: VideoPlaylistT[]; total: number }>(`api/playlists-moderation/my/playlists?${params}`, 'GET', undefined, signal);
    return { playlists: data.playlists, total: data.total };
  }
  const data = await request<{ playlists: VideoPlaylistT[]; total: number }>(`api/playlists/search?${params}`, 'GET', undefined, signal);
  return { playlists: data.playlists, total: data.total };
}
