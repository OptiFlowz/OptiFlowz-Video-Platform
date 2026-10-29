import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { HttpError } from '../../../../common/httpError.js';
import { requireQuizAttemptUser } from '../helpers/quiz-attempts.validation.js';
import { quizResultsParamsSchema, listQuizResultsSchema } from '../helpers/quizAttemptManagement.validation.js';
import { listQuizResultsByUser } from '../repository/quiz-attempt-management.repository.js';

export async function getQuizResultsByUserInternal(params, query, ownerId, database = writePool) {
  requireQuizAttemptUser(ownerId);
  const { quizId } = validateOrThrow(quizResultsParamsSchema.safeParse(params));
  const input = validateOrThrow(listQuizResultsSchema.safeParse(query));
  const result = await listQuizResultsByUser(database, quizId, ownerId, input);
  if (!result) throw new HttpError(404, { message: 'Quiz not found' });
  const { users, total } = result;
  const { page, limit, sortBy, sortOrder } = input;
  const totalPages = Math.ceil(total / limit);
  return { users,
    pagination: { page, limit, total, totalPages, hasNextPage: page < totalPages, hasPreviousPage: page > 1 },
    sorting: { sortBy, sortOrder } };
}
