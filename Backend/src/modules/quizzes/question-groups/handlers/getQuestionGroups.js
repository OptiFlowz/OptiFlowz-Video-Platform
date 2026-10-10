import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { listQuestionGroupsSchema, requireQuestionGroupUser } from '../helpers/question-groups.validation.js';
import { listQuestionGroups } from '../repository/question-groups.repository.js';

export async function getQuestionGroupsInternal(query, userId) {
  requireQuestionGroupUser(userId);
  const { name, page, limit, sortBy, sortOrder } = validateOrThrow(listQuestionGroupsSchema.safeParse(query));
  const offset = (page - 1) * limit;
  const { groups, total } = await listQuestionGroups(writePool, userId, { name, limit, offset, sortBy, sortOrder });
  const totalPages = Math.ceil(total / limit);
  return {
    groups,
    pagination: {
      page, limit, total, totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
    sorting: { sortBy, sortOrder },
  };
}
