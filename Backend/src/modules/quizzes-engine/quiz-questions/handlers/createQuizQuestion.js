import { validateOrThrow } from '../../../../common/input.validation.js';
import { quizQuestionsParamsSchema, createQuizQuestionSchema, requireQuizQuestionUser } from '../helpers/quiz-questions.validation.js';
import { withQuizQuestionTransaction } from '../helpers/quizQuestionTransaction.js';
import { createQuizQuestion } from '../repository/quiz-questions.repository.js';

export async function createQuizQuestionInternal(params, body, userId) {
  requireQuizQuestionUser(userId);
  const { quizId } = validateOrThrow(quizQuestionsParamsSchema.safeParse(params));
  const input = validateOrThrow(createQuizQuestionSchema.safeParse(body));
  return withQuizQuestionTransaction(quizId, input.question_id, userId,
    client => createQuizQuestion(client, quizId, userId, input));
}
