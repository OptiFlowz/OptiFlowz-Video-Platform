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

export async function getPlatformOverviewAnalyticsInternal(object, userId = null) {
  const { fromDate, toDate } = prerequisites(object, userId);

  const { rows } = await readPool.query(
    `
      WITH RECURSIVE filtered_views AS (
        SELECT
          vv.user_id,
          vv.ip_address,
          vv.user_agent,
          vv.watch_duration
        FROM video_views vv
        WHERE ($1::timestamptz IS NULL OR vv.created_at >= $1)
          AND ($2::timestamptz IS NULL OR vv.created_at <= $2)
      ),
      viewer_watch_times AS (
        SELECT SUM(COALESCE(watch_duration, 0)) AS watch_time
        FROM filtered_views
        GROUP BY
          user_id,
          CASE WHEN user_id IS NULL THEN ip_address END,
          CASE WHEN user_id IS NULL THEN user_agent END
      ),
      visible_comments AS (
        SELECT vc.id, vc.created_at
        FROM video_comments vc
        WHERE vc.parent_id IS NULL
          AND vc.is_deleted = false

        UNION ALL

        SELECT child.id, child.created_at
        FROM video_comments child
        INNER JOIN visible_comments parent ON parent.id = child.parent_id
        WHERE child.is_deleted = false
      )
      SELECT
        (SELECT COUNT(*) FROM users) AS total_users,
        (
          SELECT COUNT(*)
          FROM users u
          WHERE ($1::timestamptz IS NULL OR u.created_at >= $1)
            AND ($2::timestamptz IS NULL OR u.created_at <= $2)
        ) AS new_users,
        (
          SELECT COUNT(*)
          FROM videos v
          WHERE ($1::timestamptz IS NULL OR v.created_at >= $1)
            AND ($2::timestamptz IS NULL OR v.created_at <= $2)
        ) AS video_count,
        (
          SELECT COUNT(*)
          FROM playlists p
          WHERE ($1::timestamptz IS NULL OR p.created_at >= $1)
            AND ($2::timestamptz IS NULL OR p.created_at <= $2)
        ) AS playlist_count,
        (SELECT COUNT(*) FROM filtered_views) AS video_views,
        (
          SELECT COALESCE(SUM(watch_duration), 0)
          FROM filtered_views
        ) AS watch_time,
        (
          SELECT COALESCE(AVG(watch_time), 0)
          FROM viewer_watch_times
        ) AS avg_watch_time_per_viewer,
        (
          SELECT COUNT(*)
          FROM video_reactions vr
          WHERE vr.reaction = 1
            AND ($1::timestamptz IS NULL OR vr.created_at >= $1)
            AND ($2::timestamptz IS NULL OR vr.created_at <= $2)
        ) AS video_likes,
        (
          SELECT COUNT(*)
          FROM video_reactions vr
          WHERE vr.reaction = -1
            AND ($1::timestamptz IS NULL OR vr.created_at >= $1)
            AND ($2::timestamptz IS NULL OR vr.created_at <= $2)
        ) AS video_dislikes,
        (
          SELECT COUNT(*)
          FROM visible_comments vc
          WHERE ($1::timestamptz IS NULL OR vc.created_at >= $1)
            AND ($2::timestamptz IS NULL OR vc.created_at <= $2)
        ) AS video_comments,
        (
          SELECT COUNT(*)
          FROM playlist_saves ps
          WHERE ($1::timestamptz IS NULL OR ps.created_at >= $1)
            AND ($2::timestamptz IS NULL OR ps.created_at <= $2)
        ) AS playlist_saves
    `,
    [fromDate ?? null, toDate ?? null],
  );

  const result = rows[0] ?? {};
  return {
    totalUsers: Number(result.total_users ?? 0),
    newUsers: Number(result.new_users ?? 0),
    videoCount: Number(result.video_count ?? 0),
    playlistCount: Number(result.playlist_count ?? 0),
    videoViews: Number(result.video_views ?? 0),
    watchTime: Number(result.watch_time ?? 0),
    avgWatchTimePerViewer: Number(result.avg_watch_time_per_viewer ?? 0),
    videoLikes: Number(result.video_likes ?? 0),
    videoDislikes: Number(result.video_dislikes ?? 0),
    videoComments: Number(result.video_comments ?? 0),
    playlistSaves: Number(result.playlist_saves ?? 0),
  };
}
