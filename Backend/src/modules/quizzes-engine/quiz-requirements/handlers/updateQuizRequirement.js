import { validateOrThrow } from '../../../../common/input.validation.js';
import { HttpError } from '../../../../common/httpError.js';
import {
  quizRequirementIdSchema, updateQuizRequirementSchema, quizRequirementFieldsSchema,
  requireQuizRequirementUser, validateVideoDuration,
} from '../helpers/quiz-requirements.validation.js';
import { withQuizRequirementTransaction } from '../helpers/quizRequirementTransaction.js';
import { getOwnedQuiz, lockAccessibleVideo, getQuizRequirement, updateQuizRequirement } from '../repository/quiz-requirements.repository.js';

export async function updateQuizRequirementInternal(params, body, userId) {
  requireQuizRequirementUser(userId);
  const { quizId, videoId } = validateOrThrow(quizRequirementIdSchema.safeParse(params));
  const updates = validateOrThrow(updateQuizRequirementSchema.safeParse(body));
  return withQuizRequirementTransaction(async client => {
    if (!await getOwnedQuiz(client, quizId, userId, true)) {
      throw new HttpError(404, { message: 'Quiz not found' });
    }
    const video = await lockAccessibleVideo(client, videoId, userId);
    if (!video) throw new HttpError(404, { message: 'Video not found' });
    const existing = await getQuizRequirement(client, quizId, videoId, userId, true);
    if (!existing) throw new HttpError(404, { message: 'Quiz requirement not found' });
    const requirement = validateOrThrow(quizRequirementFieldsSchema.safeParse({
      min_watch_percentage: existing.min_watch_percentage,
      min_watch_seconds: existing.min_watch_seconds,
      position: existing.position,
      ...Object.fromEntries(Object.entries(updates).filter(([, value]) => value !== undefined)),
    }));
    validateVideoDuration(requirement, video);
    return updateQuizRequirement(client, quizId, videoId, userId, requirement);
  });
}
