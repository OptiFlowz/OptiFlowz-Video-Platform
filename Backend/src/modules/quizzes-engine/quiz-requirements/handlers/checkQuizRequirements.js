import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { checkQuizRequirementsSchema, requireQuizRequirementUser } from '../helpers/quiz-requirements.validation.js';
import { areQuizRequirementsMet } from '../repository/quiz-requirements.repository.js';

// Checks a participant's progress, independently of who owns the quiz.
export async function checkQuizRequirementsInternal(quizId, userId) {
  requireQuizRequirementUser(userId);
  const input = validateOrThrow(checkQuizRequirementsSchema.safeParse({ quizId, userId }));
  return areQuizRequirementsMet(writePool, input.quizId, input.userId);
}
