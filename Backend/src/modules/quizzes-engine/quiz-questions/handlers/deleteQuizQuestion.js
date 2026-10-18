import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { HttpError } from '../../../../common/httpError.js';
import { quizQuestionParamsSchema, requireQuizQuestionUser } from '../helpers/quiz-questions.validation.js';
import { deleteQuizQuestion } from '../repository/quiz-questions.repository.js';

export async function deleteQuizQuestionInternal(params, userId) {
  requireQuizQuestionUser(userId);
  const { quizId, questionId } = validateOrThrow(quizQuestionParamsSchema.safeParse(params));
  if (!await deleteQuizQuestion(writePool, quizId, questionId, userId)) {
    throw new HttpError(404, { message: 'Quiz question not found' });
  }
  return { deleted: true };
}
