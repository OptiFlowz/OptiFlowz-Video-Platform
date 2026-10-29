import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { HttpError } from '../../../../common/httpError.js';
import { requireQuizAttemptUser } from '../helpers/quiz-attempts.validation.js';
import { quizResultParamsSchema } from '../helpers/quizAttemptManagement.validation.js';
import { getQuizResult } from '../repository/quiz-attempt-management.repository.js';

export async function getQuizResultInternal(params, ownerId, database = writePool) {
  requireQuizAttemptUser(ownerId);
  const { quizId, attemptId } = validateOrThrow(quizResultParamsSchema.safeParse(params));
  const attempt = await getQuizResult(database, quizId, attemptId, ownerId);
  if (!attempt) throw new HttpError(404, { message: 'Quiz attempt not found' });
  return { attempt };
}
