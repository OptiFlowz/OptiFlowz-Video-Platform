import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { createQuizSchema, requireQuizUser } from '../helpers/quizzes.validation.js';
import { createQuiz } from '../repository/quizzes.repository.js';

export async function createQuizInternal(body, userId) {
  requireQuizUser(userId);
  const quiz = validateOrThrow(createQuizSchema.safeParse(body));
  return createQuiz(writePool, userId, quiz);
}
