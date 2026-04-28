import { readPool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';

function prerequisites(object) {
  const schema = z.object({
    userId: z.string().uuid('Invalid user ID'),
    sortBy: z.enum(['created_at']).optional().default('created_at'),
    sortOrder: z.enum(['asc', 'desc']).optional().default('asc'),
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  });

  return validateOrThrow(schema.safeParse(object));
}

export async function getUserQuizzesInternal(object, userId = null) {
  const input = prerequisites({
    ...object,
    userId: userId ?? object?.userId,
  });

  const { userId: validatedUserId, sortBy, sortOrder, page, limit } = input;

  const offset = (page - 1) * limit;

  const allowedSortFields = {
    created_at: 'q.created_at',
  };

  const orderByField = allowedSortFields[sortBy];
  const orderByDirection = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  const [countResult, quizzesResult] = await Promise.all([
    readPool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM quizzes q
        WHERE q.created_by = $1
      `,
      [validatedUserId]
    ),

    readPool.query(
      `
        SELECT 
          q.id,
          q.title,
          q.description
        FROM quizzes q
        WHERE q.created_by = $1
        ORDER BY ${orderByField} ${orderByDirection}
        LIMIT $2 OFFSET $3
      `,
      [validatedUserId, limit, offset]
    ),
  ]);

  const total = countResult.rows[0]?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  return {
    quizzes: quizzesResult.rows,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
    sorting: {
      sortBy,
      sortOrder,
    },
  };
}