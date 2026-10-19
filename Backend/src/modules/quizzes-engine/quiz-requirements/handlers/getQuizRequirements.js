import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { HttpError } from '../../../../common/httpError.js';
import { listQuizRequirementsSchema, requireQuizRequirementUser } from '../helpers/quiz-requirements.validation.js';
import { withQuizRequirementVideoCards } from '../helpers/quizRequirementVideoCards.js';
import { getOwnedQuiz, listQuizRequirements } from '../repository/quiz-requirements.repository.js';

export async function getQuizRequirementsInternal(query, userId, access, viewerId = userId) {
  requireQuizRequirementUser(userId);
  const { quiz_id, page, limit, sortBy, sortOrder } = validateOrThrow(listQuizRequirementsSchema.safeParse(query));
  if (quiz_id && !await getOwnedQuiz(writePool, quiz_id, userId)) {
    throw new HttpError(404, { message: 'Quiz not found' });
  }
  const { requirements, total } = await listQuizRequirements(writePool, access?.canAccessAny === true ? null : userId, {
    quiz_id, limit, offset: (page - 1) * limit, sortBy, sortOrder,
  });
  const totalPages = Math.ceil(total / limit);
  return {
    requirements: await withQuizRequirementVideoCards(requirements, viewerId),
    pagination: {
      page, limit, total, totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
    sorting: { sortBy, sortOrder },
  };
}
