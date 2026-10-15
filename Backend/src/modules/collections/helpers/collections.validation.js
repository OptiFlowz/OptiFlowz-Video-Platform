import { z } from 'zod';
import { HttpError } from '../../../common/httpError.js';

const collectionFields = {
  title: z.string().trim().min(1).max(255),
  subheading: z.string().trim().max(255).nullable(),
  description: z.string().trim().nullable(),
  visibility: z.enum(['private', 'public']),
  is_featured: z.boolean(),
};
const uuid = z.string().uuid().transform(id => id.toLowerCase());
const playlistIds = z.array(uuid).refine(ids => new Set(ids).size === ids.length, {
  message: 'Each playlist must appear only once',
});

export const createCollectionSchema = z.object({
  ...collectionFields,
  description: collectionFields.description.optional().default(null),
  subheading: collectionFields.subheading.optional().default(null),
  visibility: collectionFields.visibility.optional().default('public'),
  is_featured: collectionFields.is_featured.optional().default(false),
}).strict();

export const collectionIdSchema = z.object({ collectionId: uuid });
export const collectionPlaylistIdSchema = collectionIdSchema.extend({ playlistId: uuid });
export const updateCollectionSchema = z.object(collectionFields).partial().strict().refine(
  updates => Object.values(updates).some(value => value !== undefined),
  { message: 'Provide at least one collection field to update' },
);
export const addCollectionPlaylistsSchema = z.object({
  playlist_ids: playlistIds.refine(ids => ids.length > 0, { message: 'Provide at least one playlist' }),
}).strict();
export const reorderCollectionPlaylistsSchema = z.object({ playlist_ids: playlistIds }).strict();

export const listCollectionsSchema = z.object({
  userId: uuid.optional(),
  title: z.string().trim().max(255).optional(),
  visibility: collectionFields.visibility.optional(),
  is_featured: z.enum(['true', 'false']).transform(value => value === 'true').optional(),
  sortBy: z.enum(['created_at', 'updated_at', 'title']).optional().default('created_at'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('asc'),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
}).strict().refine(query => Number.isSafeInteger((query.page - 1) * query.limit), {
  message: 'Pagination offset exceeds the supported range', path: ['page'],
});

export function requireCollectionUser(userId) {
  if (!userId) throw new HttpError(401, { message: 'Unauthorized' });
}
