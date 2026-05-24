import { writePool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';
import { finalizeQuizAttempt } from './finalizeQuizAttempt.js';

function prerequisites(object, userId) {
  const schema = z.object({
    attemptId: z.string().uuid('Invalid attempt ID'),
    userId: z.string().uuid('Invalid user ID'),
  });

  if (!userId) {
    const error = new Error('Unauthorized');
    error.status = 401;
    throw error;
  }

  return validateOrThrow(schema.safeParse({ ...object, userId }));
}

async function getAttempt(client, attemptId, userId) {
  const { rows } = await client.query(
    `
      SELECT *
      FROM quiz_attempts
      WHERE id = $1
        AND user_id = $2
      FOR UPDATE;
    `,
    [attemptId, userId]
  );

  return rows[0] || null;
}

export async function submitQuizAttemptInternal(object, userId = null) {
  const { attemptId, userId: validatedUserId } = prerequisites(object, userId);
  const client = await writePool.connect();

  try {
    await client.query('BEGIN');

    const attempt = await getAttempt(client, attemptId, validatedUserId);

    if (!attempt) {
      const error = new Error('Quiz attempt not found');
      error.status = 404;
      throw error;
    }

    if (attempt.status !== 'in_progress') {
      const error = new Error('Quiz attempt is not in progress.');
      error.status = 409;
      throw error;
    }

    const finalizedAttempt = await finalizeQuizAttempt(client, attemptId, validatedUserId);

    await client.query('COMMIT');

    return finalizedAttempt;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
