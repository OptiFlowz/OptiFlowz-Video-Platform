import { readPool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';
import { assertVideoOwner } from '../../../common/videoOwnership.js';
import { buildDateFilter } from '../helpers/dateFilter.js';

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

  // videoId and groupBy occupy $1 and $2, so date parameters start at $3.
  const filter = buildDateFilter('vv', fromDate, toDate, 2);
  const { rows } = await readPool.query(
    `
      SELECT
        DATE_TRUNC($2, vv.created_at) AS period_start,
        COUNT(*) AS view_count
      FROM video_views vv
      WHERE vv.video_id = $1${filter.sql}
      GROUP BY period_start
      ORDER BY period_start ASC
    `,
    [videoId, groupBy, ...filter.values],
  );

  return rows.map((row) => ({
    periodStart: row.period_start,
    views: Number(row.view_count),
  }));
}
