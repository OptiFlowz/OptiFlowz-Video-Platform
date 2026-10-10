import { z } from 'zod';
import { HttpError } from '../../../../common/httpError.js';

const groupFields = {
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().nullable(),
};

export const groupIdSchema = z.object({ groupId: z.string().uuid('Invalid question group ID') });
export const createQuestionGroupSchema = z.object({
  ...groupFields,
  description: groupFields.description.optional().default(null),
}).strict();

export const updateQuestionGroupSchema = z.object(groupFields).partial().strict().refine(
  updates => Object.values(updates).some(value => value !== undefined),
  { message: 'Provide at least one question group field to update' },
);

export const listQuestionGroupsSchema = z.object({
  name: z.string().trim().max(255).optional(),
  sortBy: z.enum(['name', 'id']).optional().default('name'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('asc'),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
}).strict().refine(query => Number.isSafeInteger((query.page - 1) * query.limit), {
  message: 'Pagination offset exceeds the supported range', path: ['page'],
});

export function requireQuestionGroupUser(userId) {
  if (!userId) throw new HttpError(401, { message: 'Unauthorized' });
}

export function mapQuestionGroupWriteError(error) {
  if (error.code === '23505' && error.constraint === 'question_groups_user_name_key') {
    return new HttpError(409, { message: 'A question group with this name already exists' });
  }
  return error;
}
