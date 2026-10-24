import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { HttpError } from '../../../../common/httpError.js';
import { quizIdSchema, updateQuizSchema, requireQuizUser } from '../helpers/quizzes.validation.js';
import { updateQuiz } from '../repository/quizzes.repository.js';
import { mapQuizSourceError } from '../../quiz-sources/helpers/quizSourceErrors.js';
import { requireAccessibleCertificateTemplate, mapQuizCertificateError } from '../helpers/quizCertificate.js';

export async function updateQuizInternal(params, body, resourceOwnerId, authenticatedUserId) {
  requireQuizUser(resourceOwnerId);
  requireQuizUser(authenticatedUserId);
  const { quizId } = validateOrThrow(quizIdSchema.safeParse(params));
  const updates = validateOrThrow(updateQuizSchema.safeParse(body));
  await requireAccessibleCertificateTemplate(writePool, updates.certificate_template_id, authenticatedUserId);
  let quiz;
  try {
    quiz = await updateQuiz(writePool, quizId, resourceOwnerId, updates);
  } catch (error) { throw mapQuizCertificateError(mapQuizSourceError(error)); }
  if (!quiz) throw new HttpError(404, { message: 'Quiz not found' });
  return quiz;
}
