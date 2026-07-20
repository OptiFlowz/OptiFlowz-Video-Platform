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

export async function getPlatformDeviceSplitInternal(object, userId = null) {
  const { fromDate, toDate } = prerequisites(object, userId);

  const filter = buildDateFilter('vv', fromDate, toDate, 0);
  const { rows } = await readPool.query(
    `
      WITH classified_views AS (
        SELECT
          CASE
            WHEN vv.user_agent ~* '(ipad|tablet|kindle|silk|playbook)'
              OR (vv.user_agent ~* 'android' AND vv.user_agent !~* 'mobile')
              THEN 'tablet'
            WHEN vv.user_agent ~* '(mobile|iphone|ipod|android)'
              THEN 'phone'
            WHEN vv.user_agent ~* '(windows nt|macintosh|x11|linux|cros)'
              THEN 'desktop'
            ELSE 'other'
          END AS device_type
        FROM video_views vv
        WHERE true${filter.sql}
      )
      SELECT
        COUNT(*) AS total_views,
        COUNT(*) FILTER (WHERE device_type = 'desktop') AS desktop,
        COUNT(*) FILTER (WHERE device_type = 'phone') AS phone,
        COUNT(*) FILTER (WHERE device_type = 'tablet') AS tablet,
        COUNT(*) FILTER (WHERE device_type = 'other') AS other
      FROM classified_views
    `,
    filter.values,
  );

  const result = rows[0] ?? {};
  return {
    totalViews: Number(result.total_views ?? 0),
    desktop: Number(result.desktop ?? 0),
    phone: Number(result.phone ?? 0),
    tablet: Number(result.tablet ?? 0),
    other: Number(result.other ?? 0),
  };
}
