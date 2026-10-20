import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { HttpError } from '../../../../common/httpError.js';
import { categoryIdSchema, requireQuestionCategoryUser } from '../helpers/question-categories.validation.js';
import { getQuestionCategoryDetails } from '../repository/question-categories.repository.js';

export async function getQuestionCategoryInternal(params, userId) {
  requireQuestionCategoryUser(userId);
  const { categoryId } = validateOrThrow(categoryIdSchema.safeParse(params));
  const category = await getQuestionCategoryDetails(writePool, categoryId, userId);
  if (!category) throw new HttpError(404, { message: 'Question category not found' });
  return category;
}
