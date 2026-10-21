import { writePool } from '../../../../database/index.js';
import { HttpError } from '../../../../common/httpError.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { requireQuestionUser } from '../helpers/questions.validation.js';
import { requireOwnedQuestionCategory } from '../helpers/questionCategories.js';
import { importQuestionsSchema } from '../helpers/questionTransfer.validation.js';
import { importMoodleXml } from '../helpers/moodleXml.js';
import { createQuestion } from '../repository/questions.repository.js';
import { findImportCategory, createImportCategory } from '../repository/questionTransfer.repository.js';

export async function importQuestionsInternal(xml, query, userId, { canCreateCategories = false } = {}) {
  requireQuestionUser(userId);
  const input = validateOrThrow(importQuestionsSchema.safeParse(query));
  const parsed = importMoodleXml(xml);
  const client = await writePool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('question-category:' || $1::text, 0))", [userId]);
    await requireOwnedQuestionCategory(client, userId, input.category_id);
    const categories = new Map(), questions = [];
    for (const { categoryName, ...question } of parsed.questions) {
      let categoryId = input.category_id ?? null;
      if (!input.category_id && categoryName) {
        if (!categories.has(categoryName)) {
          let id = await findImportCategory(client, userId, categoryName);
          if (!id) {
            if (!canCreateCategories) throw new HttpError(403, { message: 'Creating categories from XML requires question_categories.create permission' });
            id = await createImportCategory(client, userId, categoryName);
          }
          categories.set(categoryName, id);
        }
        categoryId = categories.get(categoryName);
      }
      const created = await createQuestion(client, userId, { ...question, category_id: categoryId });
      questions.push({ id: created.id, type: created.type, max_points: created.max_points, category: created.category });
    }
    await client.query('COMMIT');
    return { imported_count: questions.length, questions, warnings: parsed.warnings };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}
