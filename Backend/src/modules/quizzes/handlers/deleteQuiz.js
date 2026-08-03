import { writePool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';
import { assertQuizOwner } from '../../../common/quizOwnership.js';

function prerequisites(object, userId) {
  const schema = z.object({
    quizId: z.string().uuid('Invalid video ID'),
  });

  if (!userId) {
    const error = new Error('Unauthorized');
    error.status = 401;
    throw error;
  }

  return validateOrThrow(schema.safeParse(object));
}

export async function deleteQuizInternal(object, userId = null) {
  const { quizId } = prerequisites(object, userId);
  await assertQuizOwner(quizId, userId);

  const { rowCount } = await writePool.query(
    `DELETE FROM quizzes WHERE id = $1`,
    [quizId]
  );

  return rowCount > 0;
}
