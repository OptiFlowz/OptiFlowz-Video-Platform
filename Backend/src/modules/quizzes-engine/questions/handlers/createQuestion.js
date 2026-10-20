import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { createQuestionSchema, requireQuestionUser } from '../helpers/questions.validation.js';
import { requireOwnedQuestionCategory } from '../helpers/questionCategories.js';
import { createQuestion } from '../repository/questions.repository.js';

export async function createQuestionInternal(body, userId) {
  requireQuestionUser(userId);
  const question = validateOrThrow(createQuestionSchema.safeParse(body));
  const client = await writePool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('question-category:' || $1::text, 0))", [userId]);
    await requireOwnedQuestionCategory(client, userId, question.category_id);
    const created = await createQuestion(client, userId, question);
    await client.query('COMMIT');
    return created;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}
