import { readPool } from '../../../database/index.js';

export async function getPersonalizedRecommendationsInternal(userId, limit = 20, page = 1) {
  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

  const sql = `
    WITH user_cat_interests AS (
      SELECT vc.category_id, COUNT(*) AS interest_score
      FROM watch_progress wp
      JOIN videos v        ON v.id = wp.video_id
      JOIN video_categories vc ON vc.video_id = v.id
      WHERE wp.user_id = $1
        AND wp.percentage_watched >= 0
      GROUP BY vc.category_id
    ),
    user_tag_interests AS (
      SELECT t.tag, COUNT(*) AS interest_score
      FROM watch_progress wp
      JOIN videos v ON v.id = wp.video_id
      CROSS JOIN LATERAL unnest(COALESCE(v.tags, '{}')) AS t(tag)
      WHERE wp.user_id = $1
        AND wp.percentage_watched >= 0
      GROUP BY t.tag
    ),
    scored AS (
      SELECT
        v.id,
        v.title,
        v.thumbnail_url,
        v.duration_seconds,
        v.view_count,
        v.created_at,
        wpp.progress_seconds,
        wpp.percentage_watched,
        u.full_name AS uploader_name,
        (
          COALESCE((
            SELECT SUM(ci.interest_score)
            FROM user_cat_interests ci
            JOIN video_categories vc ON vc.category_id = ci.category_id
            WHERE vc.video_id = v.id
          ), 0) * 3
          +
          COALESCE((
            SELECT SUM(ti.interest_score)
            FROM user_tag_interests ti
            WHERE ti.tag = ANY (COALESCE(v.tags, '{}'))
          ), 0)
        ) AS personal_score,
        COALESCE(ppl.people, '[]'::json) AS people
      FROM videos v
      LEFT JOIN users u ON u.id = v.uploaded_by
      LEFT JOIN watch_progress wpp ON (wpp.user_id=$1 AND wpp.video_id=v.id)
      LEFT JOIN LATERAL (
        SELECT json_agg(
          json_build_object('id', p.id, 'name', p.name, 'image_url', p.image_url)
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
        AND NOT EXISTS (
          SELECT 1
          FROM watch_progress wp2
          WHERE wp2.user_id = $1
            AND wp2.video_id = v.id
            AND wp2.percentage_watched > 30
        )
    )
    SELECT *
    FROM scored
    WHERE personal_score > 4
    ORDER BY personal_score DESC, created_at DESC
    LIMIT $2 OFFSET $3;
  `;

  const { rows } = await readPool.query(sql, [userId, limit, offset]);
  return rows;
}
