import { readPool } from '../../../database/index.js';
import { HttpError } from '../../../common/httpError.js';

export async function getTrendingInternal({ query: queryParams }, actorUserId = null) {
  try {
    const { limit = 20, page = 1 } = queryParams;
    const userId = actorUserId || null;

    const query = `
            WITH recent AS (
                SELECT video_id, COUNT(DISTINCT id) AS recent_views
                FROM video_views
                WHERE created_at > NOW() - INTERVAL '30 days'
                GROUP BY video_id
            )
            SELECT
                v.id,
                v.title,
                v.thumbnail_url,
                v.duration_seconds,
                v.view_count,
                v.created_at,
                u.full_name AS uploader_name,
                ${userId ? 'wp.progress_seconds,wp.percentage_watched,' : ''}
                COALESCE(r.recent_views, 0) AS recent_views,
                COALESCE(ppl.people, '[]'::json) AS people
            FROM videos v
            LEFT JOIN users u
                ON v.uploaded_by = u.id
            ${userId ? 'LEFT JOIN watch_progress wp ON (wp.user_id = $3 AND wp.video_id = v.id)' : ''}
            LEFT JOIN recent r
                ON r.video_id = v.id
            LEFT JOIN LATERAL (
                SELECT json_agg(
                        json_build_object(
                        'id', p.id,
                        'name', p.name,
                        'image_url', p.image_url
                        )
                        ORDER BY p.name
                    ) AS people
                FROM (
                SELECT DISTINCT p.id, p.name, p.image_url
                FROM video_chairs vc
                JOIN people p ON p.id = vc.person_id
                WHERE vc.video_id = v.id
                ) p
            ) ppl ON TRUE
            WHERE v.mux_status = 'ready' AND v.visibility = 'public'
                AND v.published_at IS NOT NULL
            ORDER BY COALESCE(r.recent_views, 0) DESC, v.view_count DESC
            LIMIT $1 OFFSET $2
        `;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    var { rows } = userId
      ? await readPool.query(query, [Math.min(parseInt(limit), 100), offset, userId])
      : await readPool.query(query, [Math.min(parseInt(limit), 100), offset]);

    return {
      videos: rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
      },
    };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error('Trending videos error:', error);
    throw new HttpError(500, { message: 'Failed to fetch trending videos' });
  }
}
