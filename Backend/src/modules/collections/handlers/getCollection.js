import { writePool } from '../../../database/index.js';
import { HttpError } from '../../../common/httpError.js';
import { validateOrThrow } from '../../../common/input.validation.js';
import { withPlaylistCardMedia } from '../../playlists/helpers/playlistCardMedia.js';
import { collectionIdSchema } from '../helpers/collections.validation.js';
import { getCollection } from '../repository/collections.repository.js';

export async function getCollectionInternal(params, viewerId = null) {
  const { collectionId } = validateOrThrow(collectionIdSchema.safeParse(params));
  const result = await getCollection(writePool, collectionId, viewerId);
  if (!result) throw new HttpError(404, { message: 'Collection not found' });
  return {
    collection: result.collection,
    playlists: await withPlaylistCardMedia(result.playlists, viewerId),
  };
}
