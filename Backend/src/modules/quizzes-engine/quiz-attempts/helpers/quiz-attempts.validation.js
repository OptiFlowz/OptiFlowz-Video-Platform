import { z } from 'zod';
import { HttpError } from '../../../../common/httpError.js';

export const quizEligibilitySchema = z.object({
  quizId: z.string().uuid('Invalid quiz ID').transform(value => value.toLowerCase()),
  userId: z.string().uuid('Invalid user ID').transform(value => value.toLowerCase()),
});

export function requireQuizAttemptUser(userId) {
  if (!userId) throw new HttpError(401, { message: 'Unauthorized' });
}
