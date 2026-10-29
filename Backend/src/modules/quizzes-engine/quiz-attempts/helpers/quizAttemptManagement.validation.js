import { z } from 'zod';
import { attemptIdSchema } from './quiz-attempts.validation.js';

const uuid = z.string().uuid().transform(value => value.toLowerCase());
export const quizResultsParamsSchema = z.object({ quizId: uuid });
export const quizResultParamsSchema = quizResultsParamsSchema.extend(attemptIdSchema.shape);

export const listQuizResultsSchema = z.object({
  user_id: uuid.optional(),
  status: z.enum(['in_progress', 'submitted', 'timed_out', 'cancelled']).optional(),
  passed: z.enum(['true', 'false']).transform(value => value === 'true').optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  sortBy: z.enum(['started_at', 'finished_at', 'attempt_no', 'status', 'earned_points', 'score_percentage'])
    .optional().default('started_at'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
}).strict().refine(query => Number.isSafeInteger((query.page - 1) * query.limit), {
  message: 'Pagination offset exceeds the supported range', path: ['page'],
});
