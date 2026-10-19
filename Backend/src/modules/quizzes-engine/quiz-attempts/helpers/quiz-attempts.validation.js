import { z } from 'zod';
import { HttpError } from '../../../../common/httpError.js';

export const quizEligibilitySchema = z.object({
  quizId: z.string().uuid('Invalid quiz ID').transform(value => value.toLowerCase()),
  userId: z.string().uuid('Invalid user ID').transform(value => value.toLowerCase()),
});

export const listQuizAttemptsSchema = z.object({
  status: z.enum(['in_progress', 'submitted', 'timed_out', 'cancelled']).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  sortBy: z.enum(['started_at', 'finished_at', 'attempt_no', 'status']).optional().default('started_at'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
}).strict().refine(query => Number.isSafeInteger((query.page - 1) * query.limit), {
  message: 'Pagination offset exceeds the supported range', path: ['page'],
});

export function requireQuizAttemptUser(userId) {
  if (!userId) throw new HttpError(401, { message: 'Unauthorized' });
}
