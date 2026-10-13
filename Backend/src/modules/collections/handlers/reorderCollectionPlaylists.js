import { validateOrThrow } from '../../../common/input.validation.js';
import { HttpError } from '../../../common/httpError.js';
import { collectionIdSchema, reorderCollectionPlaylistsSchema, requireCollectionUser } from '../helpers/collections.validation.js';
import { withCollectionTransaction } from '../helpers/collectionTransaction.js';
import { lockCollectionPlaylists, setCollectionPlaylistOrder, touchCollection } from '../repository/collections.repository.js';

export async function reorderCollectionPlaylistsInternal(params, body, userId, access) {
  requireCollectionUser(userId);
  const { collectionId } = validateOrThrow(collectionIdSchema.safeParse(params));
  const { playlist_ids: playlistIds } = validateOrThrow(reorderCollectionPlaylistsSchema.safeParse(body));
  return withCollectionTransaction(collectionId, userId, access, async client => {
    const current = await lockCollectionPlaylists(client, collectionId);
    const existing = new Set(current.map(item => item.playlist_id));
    if (playlistIds.length !== current.length || playlistIds.some(id => !existing.has(id))) {
      throw new HttpError(409, { message: 'Provide every playlist currently in the collection exactly once' });
    }
    await setCollectionPlaylistOrder(client, collectionId, playlistIds);
    const collection = await touchCollection(client, collectionId);
    return { collection, playlists: await lockCollectionPlaylists(client, collectionId) };
  });
}
