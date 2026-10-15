import { writePool } from '../../../database/index.js';
import { validateOrThrow } from '../../../common/input.validation.js';
import { HttpError } from '../../../common/httpError.js';
import { collectionIdSchema, updateCollectionSchema, requireCollectionUser } from '../helpers/collections.validation.js';
import { updateCollection } from '../repository/collections.repository.js';
import { requireCollectionFeaturePermission } from '../helpers/collectionFeaturePermission.js';

export async function updateCollectionInternal(params, body, userId, access, authorization) {
  requireCollectionUser(userId);
  const { collectionId } = validateOrThrow(collectionIdSchema.safeParse(params));
  const updates = validateOrThrow(updateCollectionSchema.safeParse(body));
  if (updates.is_featured !== undefined) await requireCollectionFeaturePermission(userId, authorization);
  const collection = await updateCollection(writePool, collectionId, userId, updates, access?.canAccessAny === true);
  if (!collection) throw new HttpError(404, { message: 'Collection not found' });
  return collection;
}
