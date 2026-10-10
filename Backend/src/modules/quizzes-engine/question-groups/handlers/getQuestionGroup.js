import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { HttpError } from '../../../../common/httpError.js';
import { groupIdSchema, requireQuestionGroupUser } from '../helpers/question-groups.validation.js';
import { getQuestionGroup } from '../repository/question-groups.repository.js';

export async function getQuestionGroupInternal(params, userId) {
  requireQuestionGroupUser(userId);
  const { groupId } = validateOrThrow(groupIdSchema.safeParse(params));
  const group = await getQuestionGroup(writePool, groupId, userId);
  if (!group) throw new HttpError(404, { message: 'Question group not found' });
  return group;
}
