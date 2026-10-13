import { writePool } from '../../../database/index.js';
import { validateOrThrow } from '../../../common/input.validation.js';
import { HttpError } from '../../../common/httpError.js';
import { collectionIdSchema, requireCollectionUser } from '../helpers/collections.validation.js';
import { deleteCollection } from '../repository/collections.repository.js';

export async function deleteCollectionInternal(params, userId, access) {
  requireCollectionUser(userId);
  const { collectionId } = validateOrThrow(collectionIdSchema.safeParse(params));
  if (!await deleteCollection(writePool, collectionId, userId, access?.canAccessAny === true)) {
    throw new HttpError(404, { message: 'Collection not found' });
  }
  return { deleted: true };
}
