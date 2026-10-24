import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { createQuizSchema, requireQuizUser } from '../helpers/quizzes.validation.js';
import { createQuiz } from '../repository/quizzes.repository.js';
import { requireAccessibleCertificateTemplate, mapQuizCertificateError } from '../helpers/quizCertificate.js';

export async function createQuizInternal(body, userId) {
  requireQuizUser(userId);
  const quiz = validateOrThrow(createQuizSchema.safeParse(body));
  await requireAccessibleCertificateTemplate(writePool, quiz.certificate_template_id, userId);
  try { return await createQuiz(writePool, userId, quiz); }
  catch (error) { throw mapQuizCertificateError(error); }
}
