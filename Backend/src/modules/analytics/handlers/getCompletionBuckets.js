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
      fromDate: z.coerce.date().optional(),
      toDate: z.coerce.date().optional(),
    })
    .refine(
      ({ fromDate, toDate }) => !fromDate || !toDate || fromDate <= toDate,
      { message: 'fromDate must be before or equal to toDate', path: ['fromDate'] },
    );

  return validateOrThrow(schema.safeParse({ ...object, userId }));
}

export async function getCompletionBucketsInternal(object, userId = null) {
  const {
    videoId,
    userId: validatedUserId,
    fromDate,
    toDate,
  } = prerequisites(object, userId);

  await assertVideoOwner(videoId, validatedUserId);

  const filter = buildDateFilter('vv', fromDate, toDate);
  const { rows } = await readPool.query(
    `
      WITH watchings AS (
        SELECT
          COALESCE(SUM(vv.watch_duration), 0) AS total_watch_seconds,
          v.duration_seconds
        FROM video_views vv
        INNER JOIN videos v ON v.id = vv.video_id
        WHERE vv.video_id = $1${filter.sql}
          AND v.duration_seconds > 0
        GROUP BY
          vv.user_id,
          CASE WHEN vv.user_id IS NULL THEN vv.ip_address END,
          CASE WHEN vv.user_id IS NULL THEN vv.user_agent END,
          v.duration_seconds
      ),
      completion AS (
        SELECT
          100.0 * total_watch_seconds
            / NULLIF(duration_seconds, 0) AS percentage
        FROM watchings
      )
      SELECT
        COUNT(*) FILTER (WHERE percentage < 25) AS less_than_25,
        COUNT(*) FILTER (WHERE percentage >= 25 AND percentage < 50) AS from_25_to_50,
        COUNT(*) FILTER (WHERE percentage >= 50 AND percentage < 75) AS from_50_to_75,
        COUNT(*) FILTER (WHERE percentage >= 75 AND percentage < 95) AS from_75_to_95,
        COUNT(*) FILTER (WHERE percentage >= 95) AS at_least_95
      FROM completion
    `,
    [videoId, ...filter.values],
  );

  const result = rows[0] ?? {};
  return {
    '<25%': Number(result.less_than_25 ?? 0),
    '25-50%': Number(result.from_25_to_50 ?? 0),
    '50-75%': Number(result.from_50_to_75 ?? 0),
    '75-95%': Number(result.from_75_to_95 ?? 0),
    '95%>': Number(result.at_least_95 ?? 0),
  };
}
