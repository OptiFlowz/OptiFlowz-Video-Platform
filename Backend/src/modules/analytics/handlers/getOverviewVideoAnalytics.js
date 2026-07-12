import { readPool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';
import { assertVideoOwner } from '../../../common/videoOwnership.js';
import { buildDateFilter } from '../helpers/dateFilter.js';

function prerequisites(object, userId) {
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

  if (!userId) {
    const error = new Error('Unauthorized');
    error.status = 401;
    throw error;
  }

  return validateOrThrow(schema.safeParse({ ...object, userId }));
}

async function getScalar(sql, values, field) {
  const { rows } = await readPool.query(sql, values);
  return Number(rows[0]?.[field] ?? 0);
}

export async function getTotalViews(videoId, fromDate, toDate) {
  const filter = buildDateFilter('vv', fromDate, toDate);
  return getScalar(
    `SELECT COUNT(*) AS value FROM video_views vv WHERE vv.video_id = $1${filter.sql}`,
    [videoId, ...filter.values],
    'value',
  );
}

export async function getFirstTimeViews(videoId, fromDate, toDate) {
  const filter = buildDateFilter('vv', fromDate, toDate);
  return getScalar(
    `SELECT COUNT(DISTINCT vv.user_id) AS value FROM video_views vv WHERE vv.video_id = $1${filter.sql}`,
    [videoId, ...filter.values],
    'value',
  );
}

export async function getTotalWatchTime(videoId, fromDate, toDate) {
  const filter = buildDateFilter('vv', fromDate, toDate);
  return getScalar(
    `SELECT COALESCE(SUM(vv.watch_duration), 0) AS value FROM video_views vv WHERE vv.video_id = $1${filter.sql}`,
    [videoId, ...filter.values],
    'value',
  );
}

async function getReactionCount(videoId, reaction, fromDate, toDate) {
  const filter = buildDateFilter('vr', fromDate, toDate, 2);
  return getScalar(
    `SELECT COUNT(*) AS value FROM video_reactions vr WHERE vr.video_id = $1 AND vr.reaction = $2${filter.sql}`,
    [videoId, reaction, ...filter.values],
    'value',
  );
}

export function getTotalLikes(videoId, fromDate, toDate) {
  return getReactionCount(videoId, 1, fromDate, toDate);
}

export function getTotalDislikes(videoId, fromDate, toDate) {
  return getReactionCount(videoId, -1, fromDate, toDate);
}

export async function getTotalComments(videoId, fromDate, toDate) {
  const filter = buildDateFilter('vc', fromDate, toDate);
  return getScalar(
    `SELECT COUNT(*) AS value FROM video_comments vc WHERE vc.video_id = $1 AND vc.is_deleted = false${filter.sql}`,
    [videoId, ...filter.values],
    'value',
  );
}

export async function getAvgWatchTimePerViewer(videoId, fromDate, toDate) {
  const filter = buildDateFilter('vv', fromDate, toDate);
  return getScalar(
    `
      SELECT COALESCE(AVG(viewer_watch_time), 0) AS value
      FROM (
        SELECT SUM(vv.watch_duration) AS viewer_watch_time
        FROM video_views vv
        WHERE vv.video_id = $1
          AND vv.user_id IS NOT NULL${filter.sql}
        GROUP BY vv.user_id
      ) viewers
    `,
    [videoId, ...filter.values],
    'value',
  );
}

export async function getOverviewVideoAnalyticsInternal(object, userId = null) {
  const { videoId, userId: validatedUserId, fromDate, toDate } = prerequisites(object, userId);

  await assertVideoOwner(videoId, validatedUserId);

  const [
    totalViews,
    firstTimeViews,
    totalWatchTime,
    totalLikes,
    totalDislikes,
    totalComments,
    avgWatchTimePerViewer,
  ] = await Promise.all([
    getTotalViews(videoId, fromDate, toDate),
    getFirstTimeViews(videoId, fromDate, toDate),
    getTotalWatchTime(videoId, fromDate, toDate),
    getTotalLikes(videoId, fromDate, toDate),
    getTotalDislikes(videoId, fromDate, toDate),
    getTotalComments(videoId, fromDate, toDate),
    getAvgWatchTimePerViewer(videoId, fromDate, toDate),
  ]);

  return {
    totalViews,
    firstTimeViews,
    totalWatchTime,
    totalLikes,
    totalDislikes,
    totalComments,
    avgWatchTimePerViewer,
  };
}
