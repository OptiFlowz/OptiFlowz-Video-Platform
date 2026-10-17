import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { HttpError } from '../../../../common/httpError.js';
import { checkQuizRequirementsSchema, requireQuizRequirementUser } from '../helpers/quiz-requirements.validation.js';
import { withQuizRequirementVideoCards } from '../helpers/quizRequirementVideoCards.js';
import { getQuizRequirementsProgress } from '../repository/quiz-requirements.repository.js';

export async function getQuizRequirementsProgressInternal(quizId, userId) {
  requireQuizRequirementUser(userId);
  const input = validateOrThrow(checkQuizRequirementsSchema.safeParse({ quizId, userId }));
  const result = await getQuizRequirementsProgress(writePool, input.quizId, input.userId);
  if (!result) throw new HttpError(404, { message: 'Quiz not found' });
  return {
    quiz_id: result.quiz_id,
    requirements_met: result.requirements.every(requirement => requirement.is_met),
    requirements: await withQuizRequirementVideoCards(result.requirements, input.userId),
  };
}
