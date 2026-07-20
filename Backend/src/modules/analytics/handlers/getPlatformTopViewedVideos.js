import { readPool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';
import {
  buildVideoCardSelect,
  buildVideoCardJoins,
  buildVideoCardVisibilityWhere,
} from '../../../database/sql/videoCardFragments.js';
import { buildDateFilter } from '../helpers/dateFilter.js';

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

export async function getPlatformTopViewedVideosInternal(object, userId = null) {
  const { fromDate, toDate } = prerequisites(object, userId);

  const filter = buildDateFilter('vv', fromDate, toDate, 0);
  const { rows } = await readPool.query(
    `
      WITH period_view_counts AS (
        SELECT vv.video_id, COUNT(*)::int AS period_views
        FROM video_views vv
        WHERE true${filter.sql}
        GROUP BY vv.video_id
      ),
      video_cards AS (
        ${buildVideoCardSelect()},v.description
        ${buildVideoCardJoins()}
        WHERE ${buildVideoCardVisibilityWhere()}
      )
      SELECT
        video_cards.*,
        COALESCE(period_view_counts.period_views, 0) AS period_views
      FROM video_cards
      LEFT JOIN period_view_counts
        ON period_view_counts.video_id = video_cards.id
      ORDER BY period_views DESC, video_cards.created_at DESC
      LIMIT 3
    `,
    filter.values,
  );

  return rows;
}
