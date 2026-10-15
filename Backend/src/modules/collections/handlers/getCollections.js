import { writePool } from '../../../database/index.js';
import { validateOrThrow } from '../../../common/input.validation.js';
import { listCollectionsSchema } from '../helpers/collections.validation.js';
import { listCollections } from '../repository/collections.repository.js';

export async function getCollectionsInternal(query, viewerId = null) {
  const { userId, title, visibility, is_featured, page, limit, sortBy, sortOrder } = validateOrThrow(listCollectionsSchema.safeParse(query));
  const { collections, total } = await listCollections(writePool, {
    userId, title, visibility, is_featured, limit, offset: (page - 1) * limit, sortBy, sortOrder,
  }, viewerId);
  const totalPages = Math.ceil(total / limit);
  return {
    collections,
    pagination: { page, limit, total, totalPages, hasNextPage: page < totalPages, hasPreviousPage: page > 1 },
    sorting: { sortBy, sortOrder },
  };
}
