import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { listQuizzesSchema, requireQuizUser } from '../helpers/quizzes.validation.js';
import { listQuizzes } from '../repository/quizzes.repository.js';

export async function getQuizzesInternal(query, userId) {
  requireQuizUser(userId);
  const { title, status, page, limit, sortBy, sortOrder } = validateOrThrow(listQuizzesSchema.safeParse(query));
  const offset = (page - 1) * limit;
  const { quizzes, total } = await listQuizzes(writePool, userId, { title, status, limit, offset, sortBy, sortOrder });
  const totalPages = Math.ceil(total / limit);
  return {
    quizzes,
    pagination: {
      page, limit, total, totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
    sorting: { sortBy, sortOrder },
  };
}
