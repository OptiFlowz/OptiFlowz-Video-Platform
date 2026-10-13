import { validateOrThrow } from '../../../common/input.validation.js';
import { HttpError } from '../../../common/httpError.js';
import { collectionPlaylistIdSchema, requireCollectionUser } from '../helpers/collections.validation.js';
import { withCollectionTransaction } from '../helpers/collectionTransaction.js';
import {
  lockCollectionPlaylists, removeCollectionPlaylist, setCollectionPlaylistOrder, touchCollection,
} from '../repository/collections.repository.js';

export async function removeCollectionPlaylistInternal(params, userId, access) {
  requireCollectionUser(userId);
  const { collectionId, playlistId } = validateOrThrow(collectionPlaylistIdSchema.safeParse(params));
  return withCollectionTransaction(collectionId, userId, access, async client => {
    const current = await lockCollectionPlaylists(client, collectionId);
    if (!await removeCollectionPlaylist(client, collectionId, playlistId)) {
      throw new HttpError(404, { message: 'Playlist not found in collection' });
    }
    await setCollectionPlaylistOrder(client, collectionId, current.filter(item => item.playlist_id !== playlistId).map(item => item.playlist_id));
    const collection = await touchCollection(client, collectionId);
    return { removed: true, collection, playlists: await lockCollectionPlaylists(client, collectionId) };
  });
}
