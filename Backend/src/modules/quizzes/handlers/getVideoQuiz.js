import { readPool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';

function prerequisites(object) {
  const schema = z.object({
    quizId: z.string().uuid('Invalid quiz ID'),
  });

  return validateOrThrow(schema.safeParse(object));
}

export async function getVideoQuizInternal(object, userId = null) {
  const { quizId } = prerequisites(object);

  const { rows } = await readPool.query(
    `
      SELECT *
        FROM quizzes
        WHERE 
        id = $1
        AND (
            is_active = true
            OR ($2::uuid IS NOT NULL AND created_by = $2::uuid)
        )
        LIMIT 1;
    `,
    [quizId, userId]
  );

  return rows[0] || null;
}