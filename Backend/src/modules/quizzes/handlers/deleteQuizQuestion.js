import { writePool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';
import { assertQuizOwner } from '../../../common/quizOwnership.js';

function prerequisites(object, userId) {
  const schema = z.object({
    quizId: z.string().uuid('Invalid quiz ID'),
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
  const { questionId, quizId } = prerequisites(object, userId);
  await assertQuizOwner(quizId,userId);

  const { rowCount } = await writePool.query(
    `DELETE FROM quiz_questions WHERE id = $1 AND quiz_id = $2`,
    [questionId, quizId]
  );

  return rowCount > 0;
}
