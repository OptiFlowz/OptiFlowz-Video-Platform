import { validateOrThrow } from '../../../../common/input.validation.js';
import { HttpError } from '../../../../common/httpError.js';
import { quizSourceParamsSchema, updateQuizSourceSchema, quizSourceFieldsSchema, requireQuizSourceUser } from '../helpers/quiz-sources.validation.js';
import { withQuizSourceTransaction } from '../helpers/quizSourceTransaction.js';
import { getQuizSource, updateQuizSource } from '../repository/quiz-sources.repository.js';

export async function updateQuizSourceInternal(params, body, userId) {
  requireQuizSourceUser(userId);
  const { quizId, sourceId } = validateOrThrow(quizSourceParamsSchema.safeParse(params));
  const updates = validateOrThrow(updateQuizSourceSchema.safeParse(body));
  return withQuizSourceTransaction(quizId, [], userId, async client => {
    const existing = await getQuizSource(client, quizId, sourceId, userId);
    if (!existing) throw new HttpError(404, { message: 'Quiz source not found' });
    const source = validateOrThrow(quizSourceFieldsSchema.safeParse({
      position: existing.position, question_percentage: existing.question_percentage,
      question_count: existing.question_count,
      ...Object.fromEntries(Object.entries(updates).filter(([, value]) => value !== undefined)),
    }));
    return updateQuizSource(client, quizId, sourceId, userId, source);
  });
}
