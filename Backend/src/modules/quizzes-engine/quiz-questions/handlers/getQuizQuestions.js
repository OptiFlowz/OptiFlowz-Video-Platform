import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { HttpError } from '../../../../common/httpError.js';
import { quizQuestionsParamsSchema, listQuizQuestionsSchema, requireQuizQuestionUser } from '../helpers/quiz-questions.validation.js';
import { getOwnedQuiz, listQuizQuestions } from '../repository/quiz-questions.repository.js';

export async function getQuizQuestionsInternal(params, query, userId) {
  requireQuizQuestionUser(userId);
  const { quizId } = validateOrThrow(quizQuestionsParamsSchema.safeParse(params));
  const { page, limit, sortBy, sortOrder } = validateOrThrow(listQuizQuestionsSchema.safeParse(query));
  if (!await getOwnedQuiz(writePool, quizId, userId)) throw new HttpError(404, { message: 'Quiz not found' });
  const { questions, total } = await listQuizQuestions(writePool, quizId, userId, {
    limit, offset: (page - 1) * limit, sortBy, sortOrder,
  });
  const totalPages = Math.ceil(total / limit);
  return {
    questions,
    pagination: { page, limit, total, totalPages, hasNextPage: page < totalPages, hasPreviousPage: page > 1 },
    sorting: { sortBy, sortOrder },
  };
}
