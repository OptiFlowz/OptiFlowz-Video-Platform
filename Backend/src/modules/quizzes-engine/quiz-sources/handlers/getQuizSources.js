import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { HttpError } from '../../../../common/httpError.js';
import { quizSourcesParamsSchema, listQuizSourcesSchema, requireQuizSourceUser } from '../helpers/quiz-sources.validation.js';
import { getOwnedQuiz, listQuizSources } from '../repository/quiz-sources.repository.js';

export async function getQuizSourcesInternal(params, query, userId) {
  requireQuizSourceUser(userId);
  const { quizId } = validateOrThrow(quizSourcesParamsSchema.safeParse(params));
  const { page, limit, sortBy, sortOrder } = validateOrThrow(listQuizSourcesSchema.safeParse(query));
  if (!await getOwnedQuiz(writePool, quizId, userId)) throw new HttpError(404, { message: 'Quiz not found' });
  const { sources, total } = await listQuizSources(writePool, quizId, userId, {
    limit, offset: (page - 1) * limit, sortBy, sortOrder,
  });
  const totalPages = Math.ceil(total / limit);
  return {
    sources,
    pagination: { page, limit, total, totalPages, hasNextPage: page < totalPages, hasPreviousPage: page > 1 },
    sorting: { sortBy, sortOrder },
  };
}
