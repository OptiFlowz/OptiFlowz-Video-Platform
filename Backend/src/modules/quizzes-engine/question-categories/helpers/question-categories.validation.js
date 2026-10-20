import { z } from 'zod';
import { HttpError } from '../../../../common/httpError.js';

const categoryFields = {
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().nullable(),
};

export const categoryIdSchema = z.object({ categoryId: z.string().uuid('Invalid question category ID') });
export const createQuestionCategorySchema = z.object({
  ...categoryFields,
  description: categoryFields.description.optional().default(null),
}).strict();

export const updateQuestionCategorySchema = z.object(categoryFields).partial().strict().refine(
  updates => Object.values(updates).some(value => value !== undefined),
  { message: 'Provide at least one question category field to update' },
);

export const syncQuestionCategoryQuestionsSchema = z.object({
  question_ids: z.array(z.string().uuid('Invalid question ID').transform(id => id.toLowerCase()))
    .transform(ids => [...new Set(ids)]),
}).strict();

export const listQuestionCategoriesSchema = z.object({
  name: z.string().trim().max(255).optional(),
  sortBy: z.enum(['name', 'id']).optional().default('name'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('asc'),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
}).strict().refine(query => Number.isSafeInteger((query.page - 1) * query.limit), {
  message: 'Pagination offset exceeds the supported range', path: ['page'],
});

export function requireQuestionCategoryUser(userId) {
  if (!userId) throw new HttpError(401, { message: 'Unauthorized' });
}

export function mapQuestionCategoryWriteError(error) {
  if (error.code === '23505' && error.constraint === 'question_categories_user_name_key') {
    return new HttpError(409, { message: 'A question category with this name already exists' });
  }
  return error;
}
