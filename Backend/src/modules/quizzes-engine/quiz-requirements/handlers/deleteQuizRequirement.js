import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { HttpError } from '../../../../common/httpError.js';
import { quizRequirementIdSchema, requireQuizRequirementUser } from '../helpers/quiz-requirements.validation.js';
import { deleteQuizRequirement } from '../repository/quiz-requirements.repository.js';

export async function deleteQuizRequirementInternal(params, userId) {
  requireQuizRequirementUser(userId);
  const { quizId, videoId } = validateOrThrow(quizRequirementIdSchema.safeParse(params));
  if (!await deleteQuizRequirement(writePool, quizId, videoId, userId)) {
    throw new HttpError(404, { message: 'Quiz requirement not found' });
  }
  return { deleted: true };
}
