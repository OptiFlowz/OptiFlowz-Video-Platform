import { readPool } from '../../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { assertVideoOwner } from '../../../../common/videoOwnership.js';
import { buildDateFilter } from '../../helpers/dateFilter.js';

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

export async function getEngagementInternal(object, userId = null) {
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
      SELECT
        COALESCE(
          SUM(COALESCE(vv.watch_duration, 0))::numeric
            / NULLIF(COUNT(vv.id) * v.duration_seconds, 0),
          0
        ) AS engagement
      FROM videos v
      LEFT JOIN video_views vv
        ON vv.video_id = v.id${filter.sql}
      WHERE v.id = $1
      GROUP BY v.duration_seconds
    `,
    [videoId, ...filter.values],
  );

  return Number(rows[0]?.engagement ?? 0);
}
