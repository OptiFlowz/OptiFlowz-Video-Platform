import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { createQuestionSchema, requireQuestionUser } from '../helpers/questions.validation.js';
import { requireOwnedQuestionGroups } from '../helpers/questionGroups.js';
import { createQuestion } from '../repository/questions.repository.js';

export async function createQuestionInternal(body, userId) {
  requireQuestionUser(userId);
  const question = validateOrThrow(createQuestionSchema.safeParse(body));
  const client = await writePool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await requireOwnedQuestionGroups(client, userId, question.group_ids);
    const created = await createQuestion(client, userId, question);
    await client.query('COMMIT');
    return created;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}
