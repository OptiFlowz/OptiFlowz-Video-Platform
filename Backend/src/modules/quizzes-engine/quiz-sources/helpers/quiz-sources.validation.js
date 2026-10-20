import { z } from 'zod';
import { HttpError } from '../../../../common/httpError.js';

const uuid = z.string().uuid().transform(value => value.toLowerCase());
const fields = {
  position: z.number().int().min(0).max(2147483647),
  question_percentage: z.number().finite().gt(0).max(100).multipleOf(0.01).nullable(),
  question_count: z.number().int().min(1).max(2147483647).nullable(),
};
const exactlyOne = input => (input.question_percentage !== null) !== (input.question_count !== null);
const modeMessage = { message: 'Exactly one of question_percentage and question_count must be set' };
export const quizSourcesParamsSchema = z.object({ quizId: uuid });
export const quizSourceParamsSchema = z.object({ quizId: uuid, sourceId: uuid });
export const quizSourceFieldsSchema = z.object(fields).strict().refine(exactlyOne, modeMessage);
export const createQuizSourceSchema = z.object({
  category_id: uuid.nullable(),
  position: fields.position.optional().default(0),
  question_percentage: fields.question_percentage.optional().default(null),
  question_count: fields.question_count.optional().default(null),
}).strict().refine(exactlyOne, modeMessage);
export const updateQuizSourceSchema = z.object(fields).partial().strict().refine(
  updates => Object.values(updates).some(value => value !== undefined),
  { message: 'Provide at least one quiz source field to update' },
);
export const replaceQuizSourcesSchema = z.object({
  sources: z.array(createQuizSourceSchema).max(1000),
}).strict().refine(input => new Set(input.sources.map(source => source.category_id)).size === input.sources.length,
  { message: 'Each category can appear only once', path: ['sources'] });
export const listQuizSourcesSchema = z.object({
  sortBy: z.enum(['position', 'id', 'category_id', 'question_percentage', 'question_count']).optional().default('position'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('asc'),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
}).strict().refine(query => Number.isSafeInteger((query.page - 1) * query.limit), {
  message: 'Pagination offset exceeds the supported range', path: ['page'],
});

export function requireQuizSourceUser(userId) {
  if (!userId) throw new HttpError(401, { message: 'Unauthorized' });
}
