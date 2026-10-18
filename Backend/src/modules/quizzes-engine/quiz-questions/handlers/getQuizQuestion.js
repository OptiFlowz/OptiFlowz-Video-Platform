import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { HttpError } from '../../../../common/httpError.js';
import { quizQuestionParamsSchema, requireQuizQuestionUser } from '../helpers/quiz-questions.validation.js';
import { getQuizQuestion } from '../repository/quiz-questions.repository.js';

export async function getQuizQuestionInternal(params, userId) {
  requireQuizQuestionUser(userId);
  const { quizId, questionId } = validateOrThrow(quizQuestionParamsSchema.safeParse(params));
  const question = await getQuizQuestion(writePool, quizId, questionId, userId);
  if (!question) throw new HttpError(404, { message: 'Quiz question not found' });
  return question;
}
