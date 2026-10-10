import { HttpError } from '../../../../common/httpError.js';
import { lockQuestionGroups } from '../repository/questions.repository.js';

export async function requireOwnedQuestionGroups(database, userId, groupIds) {
  if (groupIds === undefined || groupIds.length === 0) return;
  if (!await lockQuestionGroups(database, userId, groupIds)) {
    // Missing and foreign groups share one response to avoid exposing ownership.
    throw new HttpError(404, { message: 'One or more question groups were not found' });
  }
}
