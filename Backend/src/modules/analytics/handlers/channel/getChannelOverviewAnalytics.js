import { readPool } from '../../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../../common/input.validation.js';

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

export async function getChannelOverviewAnalyticsInternal(object, userId = null) {
  const {
    userId: validatedUserId,
    fromDate,
    toDate,
  } = prerequisites(object, userId);

  const { rows } = await readPool.query(
    `
      WITH RECURSIVE channel_videos AS (
        SELECT id
        FROM videos
        WHERE uploaded_by = $1
      ),
      filtered_views AS (
        SELECT vv.user_id, vv.watch_duration
        FROM video_views vv
        INNER JOIN channel_videos cv ON cv.id = vv.video_id
        WHERE ($2::timestamptz IS NULL OR vv.created_at >= $2)
          AND ($3::timestamptz IS NULL OR vv.created_at <= $3)
      ),
      filtered_reactions AS (
        SELECT vr.reaction
        FROM video_reactions vr
        INNER JOIN channel_videos cv ON cv.id = vr.video_id
        WHERE ($2::timestamptz IS NULL OR vr.created_at >= $2)
          AND ($3::timestamptz IS NULL OR vr.created_at <= $3)
      ),
      visible_comments AS (
        SELECT vc.id, vc.created_at
        FROM video_comments vc
        INNER JOIN channel_videos cv ON cv.id = vc.video_id
        WHERE vc.parent_id IS NULL
          AND vc.is_deleted = false

        UNION ALL

        SELECT child.id, child.created_at
        FROM video_comments child
        INNER JOIN visible_comments parent ON parent.id = child.parent_id
        INNER JOIN channel_videos cv ON cv.id = child.video_id
        WHERE child.is_deleted = false
      ),
      viewer_watch_times AS (
        SELECT user_id, SUM(COALESCE(watch_duration, 0)) AS watch_time
        FROM filtered_views
        WHERE user_id IS NOT NULL
        GROUP BY user_id
      )
      SELECT
        (SELECT COUNT(*) FROM filtered_views) AS total_views,
        (SELECT COUNT(DISTINCT user_id) FROM filtered_views) AS first_time_views,
        (SELECT COALESCE(SUM(watch_duration), 0) FROM filtered_views) AS total_watch_time,
        (SELECT COUNT(*) FROM filtered_reactions WHERE reaction = 1) AS total_likes,
        (SELECT COUNT(*) FROM filtered_reactions WHERE reaction = -1) AS total_dislikes,
        (
          SELECT COUNT(*)
          FROM visible_comments
          WHERE ($2::timestamptz IS NULL OR created_at >= $2)
            AND ($3::timestamptz IS NULL OR created_at <= $3)
        ) AS total_comments,
        (SELECT COALESCE(AVG(watch_time), 0) FROM viewer_watch_times)
          AS avg_watch_time_per_viewer
    `,
    [validatedUserId, fromDate ?? null, toDate ?? null],
  );

  const result = rows[0] ?? {};
  return {
    totalViews: Number(result.total_views ?? 0),
    firstTimeViews: Number(result.first_time_views ?? 0),
    totalWatchTime: Number(result.total_watch_time ?? 0),
    totalLikes: Number(result.total_likes ?? 0),
    totalDislikes: Number(result.total_dislikes ?? 0),
    totalComments: Number(result.total_comments ?? 0),
    avgWatchTimePerViewer: Number(result.avg_watch_time_per_viewer ?? 0),
  };
}
