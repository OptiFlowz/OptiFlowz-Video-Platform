import { readPool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';
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

export async function getPlatformOperatingSystemSplitInternal(object, userId = null) {
  const { fromDate, toDate } = prerequisites(object, userId);
  const filter = buildDateFilter('vv', fromDate, toDate, 0);

  const { rows } = await readPool.query(
    `
      WITH classified_views AS (
        SELECT
          CASE
            WHEN vv.user_agent ~* '(iphone|ipad|ipod)' THEN 'ios'
            WHEN vv.user_agent ~* 'android' THEN 'android'
            WHEN vv.user_agent ~* 'windows' THEN 'windows'
            WHEN vv.user_agent ~* '(macintosh|mac os x)' THEN 'macos'
            WHEN vv.user_agent ~* '(linux|x11)' THEN 'linux'
            ELSE 'other'
          END AS operating_system
        FROM video_views vv
        WHERE true${filter.sql}
      )
      SELECT
        COUNT(*) AS total_views,
        COUNT(*) FILTER (WHERE operating_system = 'windows') AS windows,
        COUNT(*) FILTER (WHERE operating_system = 'macos') AS macos,
        COUNT(*) FILTER (WHERE operating_system = 'android') AS android,
        COUNT(*) FILTER (WHERE operating_system = 'ios') AS ios,
        COUNT(*) FILTER (WHERE operating_system = 'linux') AS linux,
        COUNT(*) FILTER (WHERE operating_system = 'other') AS other
      FROM classified_views
    `,
    filter.values,
  );

  const result = rows[0] ?? {};
  return {
    totalViews: Number(result.total_views ?? 0),
    windows: Number(result.windows ?? 0),
    macOS: Number(result.macos ?? 0),
    android: Number(result.android ?? 0),
    iOS: Number(result.ios ?? 0),
    linux: Number(result.linux ?? 0),
    other: Number(result.other ?? 0),
  };
}
