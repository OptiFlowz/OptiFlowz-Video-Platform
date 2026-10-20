import { validateOrThrow } from '../../../../common/input.validation.js';
import { quizSourcesParamsSchema, replaceQuizSourcesSchema, requireQuizSourceUser } from '../helpers/quiz-sources.validation.js';
import { withQuizSourceTransaction } from '../helpers/quizSourceTransaction.js';
import { replaceQuizSources } from '../repository/quiz-sources.repository.js';

export async function replaceQuizSourcesInternal(params, body, userId) {
  requireQuizSourceUser(userId);
  const { quizId } = validateOrThrow(quizSourcesParamsSchema.safeParse(params));
  const { sources } = validateOrThrow(replaceQuizSourcesSchema.safeParse(body));
  return withQuizSourceTransaction(quizId, sources.map(source => source.category_id), userId,
    async client => ({ sources: await replaceQuizSources(client, quizId, userId, sources) }));
}
