import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { listQuestionCategoriesSchema, requireQuestionCategoryUser } from '../helpers/question-categories.validation.js';
import { listQuestionCategories } from '../repository/question-categories.repository.js';

export async function getQuestionCategoriesInternal(query, userId, access) {
  requireQuestionCategoryUser(userId);
  const { name, page, limit, sortBy, sortOrder } = validateOrThrow(listQuestionCategoriesSchema.safeParse(query));
  const offset = (page - 1) * limit;
  const { categories, total } = await listQuestionCategories(writePool, access?.canAccessAny === true ? null : userId, { name, limit, offset, sortBy, sortOrder });
  const totalPages = Math.ceil(total / limit);
  return {
    categories,
    pagination: {
      page, limit, total, totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
    sorting: { sortBy, sortOrder },
  };
}
