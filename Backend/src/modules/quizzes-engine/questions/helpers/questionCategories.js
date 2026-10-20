import { HttpError } from '../../../../common/httpError.js';
import { lockQuestionCategory } from '../repository/questions.repository.js';

export async function requireOwnedQuestionCategory(database, userId, categoryId) {
  if (categoryId == null) return;
  if (!await lockQuestionCategory(database, userId, categoryId)) {
    throw new HttpError(404, { message: 'Question category not found' });
  }
}
