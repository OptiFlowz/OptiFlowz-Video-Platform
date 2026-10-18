import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { HttpError } from '../../../../common/httpError.js';
import { groupIdSchema, requireQuestionGroupUser } from '../helpers/question-groups.validation.js';
import { deleteQuestionGroup } from '../repository/question-groups.repository.js';
import { mapQuizSourceError } from '../../quiz-sources/helpers/quizSourceErrors.js';

export async function deleteQuestionGroupInternal(params, userId) {
  requireQuestionGroupUser(userId);
  const { groupId } = validateOrThrow(groupIdSchema.safeParse(params));
  let deleted;
  try {
    deleted = await deleteQuestionGroup(writePool, groupId, userId);
  } catch (error) { throw mapQuizSourceError(error); }
  if (!deleted) {
    throw new HttpError(404, { message: 'Question group not found' });
  }
  return { deleted: true };
}
