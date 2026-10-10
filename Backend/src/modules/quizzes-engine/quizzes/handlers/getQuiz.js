import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { HttpError } from '../../../../common/httpError.js';
import { quizIdSchema, requireQuizUser } from '../helpers/quizzes.validation.js';
import { getQuiz } from '../repository/quizzes.repository.js';

export async function getQuizInternal(params, userId) {
  requireQuizUser(userId);
  const { quizId } = validateOrThrow(quizIdSchema.safeParse(params));
  const quiz = await getQuiz(writePool, quizId, userId);
  if (!quiz) throw new HttpError(404, { message: 'Quiz not found' });
  return quiz;
}
