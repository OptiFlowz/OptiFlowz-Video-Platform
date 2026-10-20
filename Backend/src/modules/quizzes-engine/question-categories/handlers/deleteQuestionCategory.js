import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { HttpError } from '../../../../common/httpError.js';
import { categoryIdSchema, requireQuestionCategoryUser } from '../helpers/question-categories.validation.js';
import { deleteQuestionCategory } from '../repository/question-categories.repository.js';
import { mapQuizSourceError } from '../../quiz-sources/helpers/quizSourceErrors.js';

export async function deleteQuestionCategoryInternal(params, userId) {
  requireQuestionCategoryUser(userId);
  const { categoryId } = validateOrThrow(categoryIdSchema.safeParse(params));
  let deleted;
  try {
    deleted = await deleteQuestionCategory(writePool, categoryId, userId);
  } catch (error) { throw mapQuizSourceError(error); }
  if (!deleted) {
    throw new HttpError(404, { message: 'Question category not found' });
  }
  return { deleted: true };
}
