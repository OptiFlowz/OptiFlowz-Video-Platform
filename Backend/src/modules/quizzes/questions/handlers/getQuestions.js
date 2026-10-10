import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { listQuestionsSchema, requireQuestionUser } from '../helpers/questions.validation.js';
import { listQuestions } from '../repository/questions.repository.js';

export async function getQuestionsInternal(query, userId) {
  requireQuestionUser(userId);
  const { type, page, limit, sortBy, sortOrder } = validateOrThrow(listQuestionsSchema.safeParse(query));
  const offset = (page - 1) * limit;
  const { questions, total } = await listQuestions(writePool, userId, { type, limit, offset, sortBy, sortOrder });
  const totalPages = Math.ceil(total / limit);
  return {
    questions,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
    sorting: {
      sortBy,
      sortOrder,
    },
  };
}
