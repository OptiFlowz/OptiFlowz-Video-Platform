import { validateOrThrow } from '../../../common/input.validation.js';
import { HttpError } from '../../../common/httpError.js';
import { collectionIdSchema, addCollectionPlaylistsSchema, requireCollectionUser } from '../helpers/collections.validation.js';
import { withCollectionTransaction } from '../helpers/collectionTransaction.js';
import {
  lockReadablePlaylists, lockCollectionPlaylists, insertCollectionPlaylists, setCollectionPlaylistOrder, touchCollection,
} from '../repository/collections.repository.js';

export async function addCollectionPlaylistsInternal(params, body, userId, access) {
  requireCollectionUser(userId);
  const { collectionId } = validateOrThrow(collectionIdSchema.safeParse(params));
  const { playlist_ids: playlistIds } = validateOrThrow(addCollectionPlaylistsSchema.safeParse(body));
  return withCollectionTransaction(collectionId, userId, access, async client => {
    if (!await lockReadablePlaylists(client, playlistIds, userId)) {
      throw new HttpError(404, { message: 'One or more playlists were not found or are not accessible' });
    }
    const current = await lockCollectionPlaylists(client, collectionId);
    const existing = new Set(current.map(item => item.playlist_id));
    if (playlistIds.some(id => existing.has(id))) {
      throw new HttpError(409, { message: 'A playlist is already in this collection' });
    }
    await insertCollectionPlaylists(client, collectionId, playlistIds, current.length);
    await setCollectionPlaylistOrder(client, collectionId, [...existing, ...playlistIds]);
    const collection = await touchCollection(client, collectionId);
    return { collection, playlists: await lockCollectionPlaylists(client, collectionId) };
  });
}
