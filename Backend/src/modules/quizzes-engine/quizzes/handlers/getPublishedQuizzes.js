import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { listPublishedQuizzesSchema, requireQuizUser } from '../helpers/quizzes.validation.js';
import { listPublishedQuizzes } from '../repository/quizzes.repository.js';

export async function getPublishedQuizzesInternal(query, userId) {
  requireQuizUser(userId);
  const { user_id, title, page, limit, sortBy, sortOrder } = validateOrThrow(listPublishedQuizzesSchema.safeParse(query));
  const { quizzes, total } = await listPublishedQuizzes(writePool, {
    user_id, title, limit, offset: (page - 1) * limit, sortBy, sortOrder,
  });
  const totalPages = Math.ceil(total / limit);
  return {
    quizzes,
    pagination: { page, limit, total, totalPages, hasNextPage: page < totalPages, hasPreviousPage: page > 1 },
    sorting: { sortBy, sortOrder },
  };
}
