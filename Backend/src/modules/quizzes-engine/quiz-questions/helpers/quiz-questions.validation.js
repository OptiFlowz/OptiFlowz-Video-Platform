import { z } from 'zod';
import { HttpError } from '../../../../common/httpError.js';

const uuid = z.string().uuid().transform(value => value.toLowerCase());
const fields = {
  position: z.number().int().min(0).max(2147483647),
  max_points: z.number().finite().gt(0).max(99999999.99).multipleOf(0.01),
};

export const quizQuestionsParamsSchema = z.object({ quizId: uuid });
export const quizQuestionParamsSchema = z.object({ quizId: uuid, questionId: uuid });
export const createQuizQuestionSchema = z.object({
  question_id: uuid,
  position: fields.position.optional().default(0),
  max_points: fields.max_points.optional(),
}).strict();
export const updateQuizQuestionSchema = z.object(fields).partial().strict().refine(
  updates => Object.values(updates).some(value => value !== undefined),
  { message: 'Provide at least one quiz question field to update' },
);
export const listQuizQuestionsSchema = z.object({
  sortBy: z.enum(['position', 'max_points', 'question_id']).optional().default('position'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('asc'),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
}).strict().refine(query => Number.isSafeInteger((query.page - 1) * query.limit), {
  message: 'Pagination offset exceeds the supported range', path: ['page'],
});

export function requireQuizQuestionUser(userId) {
  if (!userId) throw new HttpError(401, { message: 'Unauthorized' });
}
