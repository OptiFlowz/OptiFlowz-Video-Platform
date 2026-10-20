import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { HttpError } from '../../../../common/httpError.js';
import {
  categoryIdSchema, updateQuestionCategorySchema, requireQuestionCategoryUser, mapQuestionCategoryWriteError,
} from '../helpers/question-categories.validation.js';
import { updateQuestionCategory } from '../repository/question-categories.repository.js';

export async function updateQuestionCategoryInternal(params, body, userId) {
  requireQuestionCategoryUser(userId);
  const { categoryId } = validateOrThrow(categoryIdSchema.safeParse(params));
  const updates = validateOrThrow(updateQuestionCategorySchema.safeParse(body));
  try {
    const category = await updateQuestionCategory(writePool, categoryId, userId, updates);
    if (!category) throw new HttpError(404, { message: 'Question category not found' });
    return category;
  } catch (error) { throw mapQuestionCategoryWriteError(error); }
}
