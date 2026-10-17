import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { HttpError } from '../../../../common/httpError.js';
import { checkQuizRequirementsSchema, requireQuizRequirementUser } from '../helpers/quiz-requirements.validation.js';
import { areQuizRequirementsMet } from '../repository/quiz-requirements.repository.js';

// Checks a participant's progress, independently of who owns the quiz.
export async function checkQuizRequirementsInternal(quizId, userId) {
  requireQuizRequirementUser(userId);
  const input = validateOrThrow(checkQuizRequirementsSchema.safeParse({ quizId, userId }));
  const result = await areQuizRequirementsMet(writePool, input.quizId, input.userId);
  if (result === null) throw new HttpError(404, { message: 'Quiz not found' });
  return result;
}
