import { z } from 'zod';
import { HttpError } from '../../../../common/httpError.js';

const positiveInteger = z.number().int().min(1).max(2147483647);
const quizStatus = z.enum(['draft', 'published', 'archived']);
const quizFields = {
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().nullable(),
  status: quizStatus,
  question_count: positiveInteger,
  time_limit_seconds: positiveInteger.nullable(),
  max_attempts: positiveInteger.nullable(),
  passing_score_percentage: z.number().finite().min(0).max(100).multipleOf(0.01),
  shuffle_questions: z.boolean(),
  shuffle_options: z.boolean(),
  has_certificate: z.boolean(),
};

export const quizIdSchema = z.object({ quizId: z.string().uuid('Invalid quiz ID') });
export const createQuizSchema = z.object({
  ...quizFields,
  description: quizFields.description.optional().default(null),
  status: quizStatus.optional().default('draft'),
  time_limit_seconds: quizFields.time_limit_seconds.optional().default(null),
  max_attempts: quizFields.max_attempts.optional().default(null),
  passing_score_percentage: quizFields.passing_score_percentage.optional().default(50),
  shuffle_questions: z.boolean().optional().default(true),
  shuffle_options: z.boolean().optional().default(true),
  has_certificate: z.boolean().optional().default(false),
}).strict();

export const updateQuizSchema = z.object(quizFields).partial().strict().refine(
  updates => Object.values(updates).some(value => value !== undefined),
  { message: 'Provide at least one quiz field to update' },
);

export const listQuizzesSchema = z.object({
  title: z.string().trim().max(255).optional(),
  status: quizStatus.optional(),
  sortBy: z.enum(['created_at', 'updated_at', 'title', 'status', 'question_count', 'passing_score_percentage'])
    .optional().default('created_at'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('asc'),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
}).strict().refine(query => Number.isSafeInteger((query.page - 1) * query.limit), {
  message: 'Pagination offset exceeds the supported range', path: ['page'],
});

export function requireQuizUser(userId) {
  if (!userId) throw new HttpError(401, { message: 'Unauthorized' });
}
