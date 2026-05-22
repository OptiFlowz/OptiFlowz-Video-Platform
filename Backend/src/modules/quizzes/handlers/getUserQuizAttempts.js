import { readPool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';

function prerequisites(object, userId) {
  const schema = z.object({
    quizId: z.string().uuid('Invalid quiz ID'),
    userId: z.string().uuid('Invalid user ID'),
  });

  if (!userId) {
    const error = new Error('Unauthorized');
    error.status = 401;
    throw error;
  }

  return validateOrThrow(schema.safeParse({ ...object, userId }));
}

export async function getUserQuizAttemptsInternal(object, userId = null) {
  const { quizId, userId: validatedUserId } = prerequisites(object, userId);

  const { rows } = await readPool.query(
    `
      SELECT
        id,
        quiz_id,
        user_id,
        attempt_number,
        status,
        started_at,
        submitted_at,
        expires_at,
        score_points,
        max_points,
        score_percentage,
        passed,
        answer_review_mode
      FROM quiz_attempts
      WHERE quiz_id = $1
        AND user_id = $2
      ORDER BY attempt_number DESC;
    `,
    [quizId, validatedUserId]
  );

  return rows;
}
