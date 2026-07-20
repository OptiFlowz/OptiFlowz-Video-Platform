import { readPool } from '../../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { assertVideoOwner } from '../../../../common/videoOwnership.js';

function prerequisites(object, userId) {
  if (!userId) {
    const error = new Error('Unauthorized');
    error.status = 401;
    throw error;
  }

  const schema = z
    .object({
      videoId: z.string().uuid('Invalid video ID'),
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

export async function getViewsOverTimeInternal(object, userId = null) {
  const {
    videoId,
    userId: validatedUserId,
    groupBy,
    fromDate,
    toDate,
  } = prerequisites(object, userId);

  await assertVideoOwner(videoId, validatedUserId);

  const { rows } = await readPool.query(
    `
      WITH filtered_views AS (
        SELECT vv.created_at
        FROM video_views vv
        WHERE vv.video_id = $1
          AND ($3::timestamptz IS NULL OR vv.created_at >= $3)
          AND ($4::timestamptz IS NULL OR vv.created_at <= $4)
      ),
      aggregated_views AS (
        SELECT
          DATE_TRUNC($2, created_at) AS period_start,
          COUNT(*) AS view_count
        FROM filtered_views
        GROUP BY period_start
      ),
      bounds AS (
        SELECT
          DATE_TRUNC($2, COALESCE($3::timestamptz, MIN(created_at))) AS start_at,
          DATE_TRUNC($2, COALESCE($4::timestamptz, MAX(created_at))) AS end_at
        FROM filtered_views
      ),
      periods AS (
        SELECT GENERATE_SERIES(
          start_at,
          end_at,
          CASE $2
            WHEN 'day' THEN INTERVAL '1 day'
            WHEN 'week' THEN INTERVAL '1 week'
            WHEN 'month' THEN INTERVAL '1 month'
          END
        ) AS period_start
        FROM bounds
      )
      SELECT
        periods.period_start,
        COALESCE(aggregated_views.view_count, 0) AS view_count
      FROM periods
      LEFT JOIN aggregated_views USING (period_start)
      ORDER BY periods.period_start ASC
    `,
    [videoId, groupBy, fromDate ?? null, toDate ?? null],
  );

  return rows.map((row) => ({
    periodStart: row.period_start,
    views: Number(row.view_count),
  }));
}
