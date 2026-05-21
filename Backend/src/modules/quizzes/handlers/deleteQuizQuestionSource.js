import { writePool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';
import { assertQuizOwner } from '../../../common/quizOwnership.js';

function prerequisites(object) {
  const schema = z.object({
    sourceId: z.string().uuid('Invalid source ID'),
  });

  return validateOrThrow(schema.safeParse(object));
}

export async function deleteQuizQuestionSourceInternal(object, userId) {
  const { sourceId } = prerequisites(object);

  const { rows: existingRows } = await writePool.query(
    `
      SELECT quiz_id
      FROM quiz_question_sources
      WHERE id = $1
      LIMIT 1;
    `,
    [sourceId]
  );

  if (existingRows.length === 0) {
    const error = new Error('Quiz question source not found.');
    error.status = 404;
    throw error;
  }

  await assertQuizOwner(existingRows[0].quiz_id, userId);

  const { rowCount } = await writePool.query(
    `
      DELETE FROM quiz_question_sources
      WHERE id = $1;
    `,
    [sourceId]
  );

  return rowCount > 0;
}