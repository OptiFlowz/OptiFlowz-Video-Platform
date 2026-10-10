import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { HttpError } from '../../../../common/httpError.js';
import {
  groupIdSchema, syncQuestionGroupQuestionsSchema, requireQuestionGroupUser,
} from '../helpers/question-groups.validation.js';
import {
  getQuestionGroup, lockGroupQuestions, lockQuestionGroup, syncQuestionGroupQuestions,
} from '../repository/question-groups.repository.js';

export async function syncQuestionGroupQuestionsInternal(params, body, userId) {
  requireQuestionGroupUser(userId);
  const { groupId } = validateOrThrow(groupIdSchema.safeParse(params));
  const { question_ids: questionIds } = validateOrThrow(syncQuestionGroupQuestionsSchema.safeParse(body));
  const client = await writePool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    if (!await getQuestionGroup(client, groupId, userId)) {
      throw new HttpError(404, { message: 'Question group not found' });
    }
    // Use the same question-before-group lock order as question PATCH/DELETE.
    // Only requested questions need locks; removing links does not alter questions.
    if (!await lockGroupQuestions(client, userId, questionIds)) {
      throw new HttpError(404, { message: 'One or more questions were not found' });
    }
    // Recheck after acquiring the group lock in case it was deleted meanwhile.
    const group = await lockQuestionGroup(client, groupId, userId);
    if (!group) throw new HttpError(404, { message: 'Question group not found' });
    const savedQuestionIds = await syncQuestionGroupQuestions(client, groupId, questionIds);
    await client.query('COMMIT');
    return { group, question_ids: savedQuestionIds };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}
