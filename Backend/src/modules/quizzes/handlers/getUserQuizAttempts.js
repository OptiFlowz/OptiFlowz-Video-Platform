import { writePool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';
import { finalizeQuizAttempt } from './finalizeQuizAttempt.js';

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
  const client = await writePool.connect();

  try {
    await client.query('BEGIN');

    const timedOutAttemptsResult = await client.query(
      `
        SELECT id
        FROM quiz_attempts
        WHERE quiz_id = $1
          AND user_id = $2
          AND status = 'in_progress'
          AND expires_at IS NOT NULL
          AND expires_at <= now()
        FOR UPDATE;
      `,
      [quizId, validatedUserId]
    );

    for (const attempt of timedOutAttemptsResult.rows) {
      await finalizeQuizAttempt(client, attempt.id, validatedUserId);
    }

    const { rows } = await client.query(
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
          answer_review_mode,
          scoring
        FROM quiz_attempts
        WHERE quiz_id = $1
          AND user_id = $2
        ORDER BY attempt_number DESC;
      `,
      [quizId, validatedUserId]
    );

    await client.query('COMMIT');

    return rows;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
