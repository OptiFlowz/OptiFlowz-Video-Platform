import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { HttpError } from '../../../../common/httpError.js';
import {
  groupIdSchema, updateQuestionGroupSchema, requireQuestionGroupUser, mapQuestionGroupWriteError,
} from '../helpers/question-groups.validation.js';
import { updateQuestionGroup } from '../repository/question-groups.repository.js';

export async function updateQuestionGroupInternal(params, body, userId) {
  requireQuestionGroupUser(userId);
  const { groupId } = validateOrThrow(groupIdSchema.safeParse(params));
  const updates = validateOrThrow(updateQuestionGroupSchema.safeParse(body));
  try {
    const group = await updateQuestionGroup(writePool, groupId, userId, updates);
    if (!group) throw new HttpError(404, { message: 'Question group not found' });
    return group;
  } catch (error) { throw mapQuestionGroupWriteError(error); }
}
