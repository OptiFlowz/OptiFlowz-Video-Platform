import { validateOrThrow } from '../../../../common/input.validation.js';
import { HttpError } from '../../../../common/httpError.js';
import { quizQuestionParamsSchema, requireQuizQuestionUser } from '../helpers/quiz-questions.validation.js';
import { deleteQuizQuestion } from '../repository/quiz-questions.repository.js';
import { withQuizQuestionTransaction } from '../helpers/quizQuestionTransaction.js';

export async function deleteQuizQuestionInternal(params, userId) {
  requireQuizQuestionUser(userId);
  const { quizId, questionId } = validateOrThrow(quizQuestionParamsSchema.safeParse(params));
  return withQuizQuestionTransaction(quizId, questionId, userId, async client => {
    if (!await deleteQuizQuestion(client, quizId, questionId, userId)) {
      throw new HttpError(404, { message: 'Quiz question not found' });
    }
    return { deleted: true };
  });
}
