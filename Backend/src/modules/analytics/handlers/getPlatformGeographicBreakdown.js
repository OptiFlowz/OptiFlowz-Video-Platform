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

export async function getPlatformGeographicBreakdownInternal(object, userId = null) {
  const { fromDate, toDate } = prerequisites(object, userId);
  const filter = buildDateFilter('vv', fromDate, toDate, 0);

  const { rows } = await readPool.query(
    `
      WITH normalized_views AS (
        SELECT
          CASE
            WHEN UPPER(BTRIM(vv.country_iso)) ~ '^[A-Z]{2}$'
              THEN UPPER(BTRIM(vv.country_iso))
            ELSE 'OTHER'
          END AS country_code,
          CASE
            WHEN UPPER(BTRIM(vv.country_iso)) ~ '^[A-Z]{2}$'
              THEN COALESCE(NULLIF(BTRIM(vv.country), ''), UPPER(BTRIM(vv.country_iso)))
            ELSE 'Other'
          END AS country_name,
          COALESCE(NULLIF(BTRIM(vv.city), ''), 'Other') AS city
        FROM video_views vv
        WHERE true${filter.sql}
      )
      SELECT
        country_code,
        MAX(country_name) AS country_name,
        city,
        COUNT(*) AS view_count
      FROM normalized_views
      GROUP BY country_code, city
      ORDER BY country_code, view_count DESC, city
    `,
    filter.values,
  );

  const countries = Object.create(null);

  for (const row of rows) {
    if (!countries[row.country_code]) {
      countries[row.country_code] = {
        name: row.country_name,
        totalViews: 0,
        cities: Object.create(null),
      };
    }

    const viewCount = Number(row.view_count);
    countries[row.country_code].totalViews += viewCount;
    countries[row.country_code].cities[row.city] = viewCount;
  }

  return countries;
}
