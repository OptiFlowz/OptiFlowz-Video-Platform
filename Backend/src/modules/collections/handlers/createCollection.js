import { writePool } from '../../../database/index.js';
import { validateOrThrow } from '../../../common/input.validation.js';
import { createCollectionSchema, requireCollectionUser } from '../helpers/collections.validation.js';
import { createCollection } from '../repository/collections.repository.js';

export async function createCollectionInternal(body, userId) {
  requireCollectionUser(userId);
  const collection = validateOrThrow(createCollectionSchema.safeParse(body));
  return createCollection(writePool, userId, collection);
}
