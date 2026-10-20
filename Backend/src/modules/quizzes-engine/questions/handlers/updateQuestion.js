import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { HttpError } from '../../../../common/httpError.js';
import {
  questionIdSchema, updateQuestionSchema, mergeQuestionUpdates, requireQuestionUser,
} from '../helpers/questions.validation.js';
import { lockQuestion, getQuestion, updateQuestion } from '../repository/questions.repository.js';
import { requireOwnedQuestionCategory } from '../helpers/questionCategories.js';

export async function updateQuestionInternal(params, body, userId) {
  requireQuestionUser(userId);
  const { questionId } = validateOrThrow(questionIdSchema.safeParse(params));
  const updates = validateOrThrow(updateQuestionSchema.safeParse(body));
  const client = await writePool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('question-category:' || $1::text, 0))", [userId]);
    if (!await lockQuestion(client, questionId, userId)) {
      throw new HttpError(404, { message: 'Question not found' });
    }
    // Read after acquiring the parent lock, so a waiting update sees committed children.
    const existing = await getQuestion(client, questionId, userId);
    const question = mergeQuestionUpdates(existing, updates);
    await requireOwnedQuestionCategory(client, userId, question.category_id);
    const updateChildren = ['type', 'options', 'matching_options', 'matching_items']
      .some(field => updates[field] !== undefined);
    const updated = await updateQuestion(client, questionId, userId, question, updateChildren);
    await client.query('COMMIT');
    return updated;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}
