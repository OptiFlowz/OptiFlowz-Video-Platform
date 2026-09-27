import { readPool } from '../../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { buildDateFilter } from '../../helpers/dateFilter.js';

function prerequisites(object, userId) {
  if (!userId) {
    const error = new Error('Unauthorized');
    error.status = 401;
    throw error;
  }

  const schema = z
    .object({
      userId: z.string().uuid('Invalid user ID'),
      fromDate: z.coerce.date().optional(),
      toDate: z.coerce.date().optional(),
    })
    .refine(
      ({ fromDate, toDate }) => !fromDate || !toDate || fromDate <= toDate,
      { message: 'fromDate must be before or equal to toDate', path: ['fromDate'] },
    );

  return validateOrThrow(schema.safeParse({ ...object, userId }));
}

export async function getChannelAverageEngagementPerVideoInternal(
  object,
  userId = null,
) {
  const {
    userId: validatedUserId,
    fromDate,
    toDate,
  } = prerequisites(object, userId);

  const filter = buildDateFilter('vv', fromDate, toDate);
  const { rows } = await readPool.query(
    `
      WITH per_video_engagement AS (
        SELECT
          v.id,
          COALESCE(
            SUM(COALESCE(vv.watch_duration, 0))::numeric
              / NULLIF(COUNT(vv.id) * v.duration_seconds, 0),
            0
          ) AS engagement
        FROM videos v
        LEFT JOIN video_views vv
          ON vv.video_id = v.id${filter.sql}
        WHERE v.uploaded_by = $1
          AND v.duration_seconds > 0
        GROUP BY v.id, v.duration_seconds
      )
      SELECT COALESCE(AVG(engagement), 0) AS average_engagement_per_video
      FROM per_video_engagement
    `,
    [validatedUserId, ...filter.values],
  );

  return Number(rows[0]?.average_engagement_per_video ?? 0);
}
