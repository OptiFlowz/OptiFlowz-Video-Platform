import { validateOrThrow } from '../../../../common/input.validation.js';
import { quizSourcesParamsSchema, createQuizSourceSchema, requireQuizSourceUser } from '../helpers/quiz-sources.validation.js';
import { withQuizSourceTransaction } from '../helpers/quizSourceTransaction.js';
import { createQuizSource } from '../repository/quiz-sources.repository.js';

export async function createQuizSourceInternal(params, body, userId) {
  requireQuizSourceUser(userId);
  const { quizId } = validateOrThrow(quizSourcesParamsSchema.safeParse(params));
  const source = validateOrThrow(createQuizSourceSchema.safeParse(body));
  return withQuizSourceTransaction(quizId, [source.group_id], userId,
    client => createQuizSource(client, quizId, userId, source));
}
