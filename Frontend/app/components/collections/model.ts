import type { VideoPlaylistT } from '~/types';

export type Collection = {
  id: string; title: string; subheading: string | null; description: string | null;
  visibility: 'public' | 'private'; thumbnail_url: string | null;
  created_by: string; created_at: string; updated_at: string;
};
export type CollectionFields = Pick<Collection, 'title' | 'subheading' | 'description' | 'visibility'>;
export type CollectionPlaylist = VideoPlaylistT & { position: number };
export type CollectionDetails = { collection: Collection; playlists: CollectionPlaylist[] };
export type CollectionsResult = { collections: Collection[]; pagination: {
  page: number; limit: number; total: number; totalPages: number; hasNextPage: boolean;
} };
export type CollectionSort = 'created_at' | 'updated_at' | 'title';
export const emptyCollection: CollectionFields = { title: '', subheading: '', description: '', visibility: 'private' };
export function collectionFields(value: CollectionFields): CollectionFields {
  return { title: value.title.trim(), subheading: value.subheading?.trim() || null,
    description: value.description?.trim() || null, visibility: value.visibility };
}
export function reorderPlaylists<T extends { id: string }>(items: T[], id: string, target: string): T[] {
  const from = items.findIndex(item => item.id === id), to = items.findIndex(item => item.id === target);
  if (from < 0 || to < 0 || from === to) return items;
  const next = [...items]; next.splice(to, 0, next.splice(from, 1)[0]); return next;
}
export function validCollectionThumbnail(file: Pick<File, 'type' | 'size'>) {
  return ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) && file.size > 0 && file.size <= 5 * 1024 * 1024;
}
