import { validateOrThrow } from '../../../../common/input.validation.js';
import { HttpError } from '../../../../common/httpError.js';
import { quizSourceParamsSchema, requireQuizSourceUser } from '../helpers/quiz-sources.validation.js';
import { withQuizSourceTransaction } from '../helpers/quizSourceTransaction.js';
import { deleteQuizSource } from '../repository/quiz-sources.repository.js';

export async function deleteQuizSourceInternal(params, userId) {
  requireQuizSourceUser(userId);
  const { quizId, groupId } = validateOrThrow(quizSourceParamsSchema.safeParse(params));
  return withQuizSourceTransaction(quizId, [groupId], userId, async client => {
    if (!await deleteQuizSource(client, quizId, groupId)) throw new HttpError(404, { message: 'Quiz source not found' });
    return { deleted: true };
  });
}
