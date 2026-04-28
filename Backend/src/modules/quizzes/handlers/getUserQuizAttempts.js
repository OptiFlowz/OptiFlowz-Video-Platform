import { readPool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';

function prerequisites(object, userId) {
  const schema = z.object({
    quizId: z.string().uuid('Invalid video ID'),
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  });

  if (!userId) {
    const error = new Error('Unauthorized');
    error.status = 401;
    throw error;
  }

  return validateOrThrow(schema.safeParse(object));
}

export async function getUserQuizAttemptsInternal(object, userId = null) {
  const { quizId, page, limit } = prerequisites(object, userId);
  const offset = (page - 1) * limit;

  const attemptsQuery = `
    SELECT a.*
    FROM quiz_attempts a
    JOIN video_quizzes q ON q.id = a.quiz_id
    WHERE q.id = $1
      AND a.user_id = $2
    ORDER BY a.attempt_number DESC
    LIMIT $3 OFFSET $4
  `;

  const countQuery = `
    SELECT COUNT(*)::int AS total
    FROM quiz_attempts a
    JOIN video_quizzes q ON q.id = a.quiz_id
    WHERE q.id = $1
      AND a.user_id = $2
  `;

  const [attemptsResult, countResult] = await Promise.all([
    readPool.query(attemptsQuery, [quizId, userId, limit, offset]),
    readPool.query(countQuery, [quizId, userId]),
  ]);

  const total = countResult.rows[0]?.total || 0;
  const totalPages = Math.ceil(total / limit);

  return {
    attempts: attemptsResult.rows,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
  };
}
