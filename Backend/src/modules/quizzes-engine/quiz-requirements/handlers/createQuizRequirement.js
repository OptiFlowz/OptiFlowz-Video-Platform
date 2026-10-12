import { validateOrThrow } from '../../../../common/input.validation.js';
import { HttpError } from '../../../../common/httpError.js';
import { createQuizRequirementSchema, requireQuizRequirementUser, validateVideoDuration } from '../helpers/quiz-requirements.validation.js';
import { withQuizRequirementTransaction } from '../helpers/quizRequirementTransaction.js';
import { getOwnedQuiz, lockAccessibleVideo, createQuizRequirement } from '../repository/quiz-requirements.repository.js';

export async function createQuizRequirementInternal(body, userId) {
  requireQuizRequirementUser(userId);
  const requirement = validateOrThrow(createQuizRequirementSchema.safeParse(body));
  return withQuizRequirementTransaction(async client => {
    if (!await getOwnedQuiz(client, requirement.quiz_id, userId, true)) {
      throw new HttpError(404, { message: 'Quiz not found' });
    }
    const video = await lockAccessibleVideo(client, requirement.video_id, userId);
    if (!video) throw new HttpError(404, { message: 'Video not found' });
    validateVideoDuration(requirement, video);
    return createQuizRequirement(client, requirement);
  });
}
