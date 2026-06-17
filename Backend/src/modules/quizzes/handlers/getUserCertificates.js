import { readPool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';

function prerequisites(object, userId) {
  const schema = z.object({
    userId: z.string().uuid('Invalid user ID'),
  });

  if (!userId) {
    const error = new Error('Unauthorized');
    error.status = 401;
    throw error;
  }

  return validateOrThrow(schema.safeParse({ ...object, userId }));
}

export async function getUserCertificatesInternal(object, userId = null) {
  const { userId: validatedUserId } = prerequisites(object, userId);

  const { rows } = await readPool.query(
    `
      WITH earliest_passed_attempts AS (
        SELECT DISTINCT ON (quiz_id)
          id,
          quiz_id,
          submitted_at
        FROM quiz_attempts
        WHERE user_id = $1
          AND passed = true
        ORDER BY
          quiz_id,
          COALESCE(submitted_at, started_at) ASC,
          attempt_number ASC,
          id ASC
      )
      SELECT
        q.id AS quiz_id,
        q.title AS quiz_title,
        epa.id AS attempt_id,
        epa.submitted_at AS date_of_completion
      FROM earliest_passed_attempts epa
      JOIN quizzes q
        ON q.id = epa.quiz_id
      WHERE q.has_certificate = true
      ORDER BY q.title ASC, q.id ASC;
    `,
    [validatedUserId]
  );

  return rows;
}
