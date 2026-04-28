import { writePool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';
import { assertQuizOwner } from '../../../common/quizOwnership.js';

function prerequisites(object, userId) {
  const schema = z.object({
    questionId: z.string().uuid('Invalid question ID'),
  });

  if (!userId) {
    const error = new Error('Unauthorized');
    error.status = 401;
    throw error;
  }

  return validateOrThrow(schema.safeParse(object));
}

export async function deleteQuizQuestionInternal(object, userId = null) {
  const { questionId } = prerequisites(object, userId);
  const result = await writePool.query(
    `SELECT quiz_id FROM quiz_questions WHERE id = $1`,
    [questionId]
  );

  if (result.rows.length === 0 || !result.rows[0].quiz_id) {
    throw new Error("Quiz ID not found for this question");
  }

  const { quiz_id } = result.rows[0];

  

  await assertQuizOwner(quiz_id,userId);

  const { rowCount } = await writePool.query(
    `DELETE FROM quiz_questions WHERE id = $1 AND quiz_id = $2`,
    [questionId, quiz_id]
  );

  return rowCount > 0;
}
