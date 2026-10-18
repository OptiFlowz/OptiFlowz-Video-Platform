import { validateOrThrow } from '../../../../common/input.validation.js';
import { HttpError } from '../../../../common/httpError.js';
import { quizQuestionParamsSchema, updateQuizQuestionSchema, requireQuizQuestionUser } from '../helpers/quiz-questions.validation.js';
import { withQuizQuestionTransaction } from '../helpers/quizQuestionTransaction.js';
import { updateQuizQuestion } from '../repository/quiz-questions.repository.js';

export async function updateQuizQuestionInternal(params, body, userId) {
  requireQuizQuestionUser(userId);
  const { quizId, questionId } = validateOrThrow(quizQuestionParamsSchema.safeParse(params));
  const updates = validateOrThrow(updateQuizQuestionSchema.safeParse(body));
  return withQuizQuestionTransaction(quizId, questionId, userId, async client => {
    const question = await updateQuizQuestion(client, quizId, questionId, userId, updates);
    if (!question) throw new HttpError(404, { message: 'Quiz question not found' });
    return question;
  });
}
