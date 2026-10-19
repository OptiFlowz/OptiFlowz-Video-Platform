import { writePool } from '../../../../database/index.js';
import { HttpError } from '../../../../common/httpError.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { quizEligibilitySchema, listQuizAttemptsSchema, requireQuizAttemptUser } from '../helpers/quiz-attempts.validation.js';
import { listQuizAttempts } from '../repository/quiz-attempts.repository.js';

export async function getQuizAttemptsInternal(quizId, query, userId, database = writePool) {
  requireQuizAttemptUser(userId);
  const input = validateOrThrow(quizEligibilitySchema.safeParse({ quizId, userId }));
  const { status, page, limit, sortBy, sortOrder } = validateOrThrow(listQuizAttemptsSchema.safeParse(query));
  const result = await listQuizAttempts(database, input.quizId, input.userId, {
    status, limit, offset: (page - 1) * limit, sortBy, sortOrder,
  });
  if (!result) throw new HttpError(404, { message: 'Quiz not found' });
  const { attempts, total } = result;
  const totalPages = Math.ceil(total / limit);
  return {
    attempts,
    pagination: { page, limit, total, totalPages, hasNextPage: page < totalPages, hasPreviousPage: page > 1 },
    sorting: { sortBy, sortOrder },
  };
}
