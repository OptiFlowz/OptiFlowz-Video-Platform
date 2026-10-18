import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { HttpError } from '../../../../common/httpError.js';
import { quizSourceParamsSchema, requireQuizSourceUser } from '../helpers/quiz-sources.validation.js';
import { getQuizSource } from '../repository/quiz-sources.repository.js';

export async function getQuizSourceInternal(params, userId) {
  requireQuizSourceUser(userId);
  const { quizId, groupId } = validateOrThrow(quizSourceParamsSchema.safeParse(params));
  const source = await getQuizSource(writePool, quizId, groupId, userId);
  if (!source) throw new HttpError(404, { message: 'Quiz source not found' });
  return source;
}
