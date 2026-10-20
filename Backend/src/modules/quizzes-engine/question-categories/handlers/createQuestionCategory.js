import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import {
  createQuestionCategorySchema, requireQuestionCategoryUser, mapQuestionCategoryWriteError,
} from '../helpers/question-categories.validation.js';
import { createQuestionCategory } from '../repository/question-categories.repository.js';

export async function createQuestionCategoryInternal(body, userId) {
  requireQuestionCategoryUser(userId);
  const category = validateOrThrow(createQuestionCategorySchema.safeParse(body));
  try {
    return await createQuestionCategory(writePool, userId, category);
  } catch (error) { throw mapQuestionCategoryWriteError(error); }
}
