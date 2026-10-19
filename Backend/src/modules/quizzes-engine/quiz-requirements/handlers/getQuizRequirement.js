import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { HttpError } from '../../../../common/httpError.js';
import { quizRequirementIdSchema, requireQuizRequirementUser } from '../helpers/quiz-requirements.validation.js';
import { withQuizRequirementVideoCards } from '../helpers/quizRequirementVideoCards.js';
import { getQuizRequirement } from '../repository/quiz-requirements.repository.js';

export async function getQuizRequirementInternal(params, userId, viewerId = userId) {
  requireQuizRequirementUser(userId);
  const { quizId, videoId } = validateOrThrow(quizRequirementIdSchema.safeParse(params));
  const requirement = await getQuizRequirement(writePool, quizId, videoId, userId);
  if (!requirement) throw new HttpError(404, { message: 'Quiz requirement not found' });
  const [result] = await withQuizRequirementVideoCards([requirement], viewerId);
  return result;
}
