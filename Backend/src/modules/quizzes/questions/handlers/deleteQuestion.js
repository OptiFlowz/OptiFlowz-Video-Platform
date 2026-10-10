import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { HttpError } from '../../../../common/httpError.js';
import { questionIdSchema, requireQuestionUser } from '../helpers/questions.validation.js';
import { deleteQuestion } from '../repository/questions.repository.js';

export async function deleteQuestionInternal(params, userId) {
  requireQuestionUser(userId);
  const { questionId } = validateOrThrow(questionIdSchema.safeParse(params));
  const client = await writePool.connect();
  try {
    await client.query('BEGIN');
    if (!await deleteQuestion(client, questionId, userId)) {
      throw new HttpError(404, { message: 'Question not found' });
    }
    // The database cascades deletion to answers and all group memberships.
    await client.query('COMMIT');
    return { deleted: true };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}
