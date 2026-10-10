import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import {
  createQuestionGroupSchema, requireQuestionGroupUser, mapQuestionGroupWriteError,
} from '../helpers/question-groups.validation.js';
import { createQuestionGroup } from '../repository/question-groups.repository.js';

export async function createQuestionGroupInternal(body, userId) {
  requireQuestionGroupUser(userId);
  const group = validateOrThrow(createQuestionGroupSchema.safeParse(body));
  try {
    return await createQuestionGroup(writePool, userId, group);
  } catch (error) { throw mapQuestionGroupWriteError(error); }
}
