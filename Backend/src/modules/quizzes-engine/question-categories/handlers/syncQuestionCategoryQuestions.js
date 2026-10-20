import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { HttpError } from '../../../../common/httpError.js';
import {
  categoryIdSchema, syncQuestionCategoryQuestionsSchema, requireQuestionCategoryUser,
} from '../helpers/question-categories.validation.js';
import {
  getQuestionCategory, lockCategoryQuestions, lockQuestionCategory, syncQuestionCategoryQuestions,
} from '../repository/question-categories.repository.js';

export async function syncQuestionCategoryQuestionsInternal(params, body, userId) {
  requireQuestionCategoryUser(userId);
  const { categoryId } = validateOrThrow(categoryIdSchema.safeParse(params));
  const { question_ids: questionIds } = validateOrThrow(syncQuestionCategoryQuestionsSchema.safeParse(body));
  const client = await writePool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('question-category:' || $1::text, 0))", [userId]);
    if (!await getQuestionCategory(client, categoryId, userId)) {
      throw new HttpError(404, { message: 'Question category not found' });
    }
    // Use the same question-before-category lock order as question PATCH/DELETE.
    // Owner-level lock also coordinates removal and moves from other categories.
    if (!await lockCategoryQuestions(client, userId, questionIds)) {
      throw new HttpError(404, { message: 'One or more questions were not found' });
    }
    // Recheck after acquiring the category lock in case it was deleted meanwhile.
    const category = await lockQuestionCategory(client, categoryId, userId);
    if (!category) throw new HttpError(404, { message: 'Question category not found' });
    const savedQuestionIds = await syncQuestionCategoryQuestions(client, categoryId, questionIds);
    await client.query('COMMIT');
    return { category, question_ids: savedQuestionIds };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}
