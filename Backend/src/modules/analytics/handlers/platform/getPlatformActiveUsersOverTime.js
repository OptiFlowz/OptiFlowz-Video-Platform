import { readPool } from '../../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../../common/input.validation.js';

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

export async function getPlatformActiveUsersOverTimeInternal(object, userId = null) {
  const { groupBy, fromDate, toDate } = prerequisites(object, userId);

  const { rows } = await readPool.query(
    `
      WITH activity AS (
        SELECT u.id AS user_id, u.created_at
        FROM users u
        WHERE ($2::timestamptz IS NULL OR u.created_at >= $2)
          AND ($3::timestamptz IS NULL OR u.created_at <= $3)

        UNION ALL

        SELECT vv.user_id, vv.created_at
        FROM video_views vv
        WHERE vv.user_id IS NOT NULL
          AND ($2::timestamptz IS NULL OR vv.created_at >= $2)
          AND ($3::timestamptz IS NULL OR vv.created_at <= $3)

        UNION ALL

        SELECT pv.user_id, pv.created_at
        FROM playlist_views pv
        WHERE pv.user_id IS NOT NULL
          AND ($2::timestamptz IS NULL OR pv.created_at >= $2)
          AND ($3::timestamptz IS NULL OR pv.created_at <= $3)
      ),
      aggregated_activity AS (
        SELECT
          DATE_TRUNC($1, created_at) AS period_start,
          COUNT(DISTINCT user_id) AS active_users
        FROM activity
        GROUP BY period_start
      ),
      bounds AS (
        SELECT
          DATE_TRUNC($1, COALESCE($2::timestamptz, MIN(created_at))) AS start_at,
          DATE_TRUNC($1, COALESCE($3::timestamptz, MAX(created_at))) AS end_at
        FROM activity
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
        COALESCE(aggregated_activity.active_users, 0) AS active_users
      FROM periods
      LEFT JOIN aggregated_activity USING (period_start)
      ORDER BY periods.period_start ASC
    `,
    [groupBy, fromDate ?? null, toDate ?? null],
  );

  return rows.map((row) => ({
    periodStart: row.period_start,
    activeUsers: Number(row.active_users),
  }));
}
