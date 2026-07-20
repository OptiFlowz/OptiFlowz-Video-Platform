import { readPool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';

function prerequisites(object, userId) {
  if (!userId) {
    const error = new Error('Unauthorized');
    error.status = 401;
    throw error;
  }

  const schema = z
    .object({
      userId: z.string().uuid('Invalid user ID'),
      groupBy: z.enum(['day', 'week', 'month']).default('day'),
      fromDate: z.coerce.date().optional(),
      toDate: z.coerce.date().optional(),
    })
    .refine(
      ({ fromDate, toDate }) => !fromDate || !toDate || fromDate <= toDate,
      { message: 'fromDate must be before or equal to toDate', path: ['fromDate'] },
    );

  return validateOrThrow(schema.safeParse({ ...object, userId }));
}

export async function getPlatformSignupsOverTimeInternal(object, userId = null) {
  const { groupBy, fromDate, toDate } = prerequisites(object, userId);

  const { rows } = await readPool.query(
    `
      WITH filtered_signups AS (
        SELECT u.created_at
        FROM users u
        WHERE ($2::timestamptz IS NULL OR u.created_at >= $2)
          AND ($3::timestamptz IS NULL OR u.created_at <= $3)
      ),
      aggregated_signups AS (
        SELECT
          DATE_TRUNC($1, created_at) AS period_start,
          COUNT(*) AS signup_count
        FROM filtered_signups
        GROUP BY period_start
      ),
      bounds AS (
        SELECT
          DATE_TRUNC($1, COALESCE($2::timestamptz, MIN(created_at))) AS start_at,
          DATE_TRUNC($1, COALESCE($3::timestamptz, MAX(created_at))) AS end_at
        FROM filtered_signups
      ),
      periods AS (
        SELECT GENERATE_SERIES(
          start_at,
          end_at,
          CASE $1
            WHEN 'day' THEN INTERVAL '1 day'
            WHEN 'week' THEN INTERVAL '1 week'
            WHEN 'month' THEN INTERVAL '1 month'
          END
        ) AS period_start
        FROM bounds
      )
      SELECT
        periods.period_start,
        COALESCE(aggregated_signups.signup_count, 0) AS signup_count
      FROM periods
      LEFT JOIN aggregated_signups USING (period_start)
      ORDER BY periods.period_start ASC
    `,
    [groupBy, fromDate ?? null, toDate ?? null],
  );

  return rows.map((row) => ({
    periodStart: row.period_start,
    signups: Number(row.signup_count),
  }));
}
