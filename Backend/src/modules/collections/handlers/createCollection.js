import { writePool } from '../../../database/index.js';
import { validateOrThrow } from '../../../common/input.validation.js';
import { createCollectionSchema, requireCollectionUser } from '../helpers/collections.validation.js';
import { createCollection } from '../repository/collections.repository.js';
import { requireCollectionFeaturePermission } from '../helpers/collectionFeaturePermission.js';

export async function createCollectionInternal(body, userId, authorization) {
  requireCollectionUser(userId);
  const collection = validateOrThrow(createCollectionSchema.safeParse(body));
  if (collection.is_featured) await requireCollectionFeaturePermission(userId, authorization);
  return createCollection(writePool, userId, collection);
}
