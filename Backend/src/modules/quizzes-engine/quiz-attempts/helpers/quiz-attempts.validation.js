import { z } from 'zod';
import { HttpError } from '../../../../common/httpError.js';

export const quizEligibilitySchema = z.object({
  quizId: z.string().uuid('Invalid quiz ID').transform(value => value.toLowerCase()),
  userId: z.string().uuid('Invalid user ID').transform(value => value.toLowerCase()),
});

export const attemptIdSchema = z.object({
  attemptId: z.string().uuid('Invalid attempt ID').transform(value => value.toLowerCase()),
});

export const attemptAnswerParamsSchema = attemptIdSchema.extend({
  questionNo: z.string().regex(/^[1-9]\d*$/, 'Invalid question number')
    .transform(Number).pipe(z.number().int().max(2147483647)),
});

const optionNumber = z.number().int().min(1).max(32767);
export const attemptAnswerSchemas = {
  single_choice: z.object({ option_no: optionNumber }).strict(),
  multiple_choice: z.object({ option_nos: z.array(optionNumber).min(1).max(32767)
    .refine(values => new Set(values).size === values.length, 'Duplicate options are not allowed') }).strict(),
  matching: z.object({ pairs: z.array(z.object({ item_no: optionNumber, option_no: optionNumber }).strict())
    .min(1).max(32767)
    .refine(pairs => new Set(pairs.map(pair => pair.item_no)).size === pairs.length, 'Duplicate matching items are not allowed') }).strict(),
};

export const attemptAnswerBodySchema = z.object({ answer: z.unknown().refine(value => value !== undefined, 'Answer is required') }).strict();

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
