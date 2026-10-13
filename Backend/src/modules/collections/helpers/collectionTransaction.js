import { writePool } from '../../../database/index.js';
import { HttpError } from '../../../common/httpError.js';
import { lockCollection } from '../repository/collections.repository.js';

export async function withCollectionTransaction(collectionId, userId, access, operation) {
  const client = await writePool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    if (!await lockCollection(client, collectionId, userId, access?.canAccessAny === true)) {
      throw new HttpError(404, { message: 'Collection not found' });
    }
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505' && error.constraint === 'collection_playlists_collection_playlist_key') {
      throw new HttpError(409, { message: 'A playlist is already in this collection' });
    }
    throw error;
  } finally { client.release(); }
}
