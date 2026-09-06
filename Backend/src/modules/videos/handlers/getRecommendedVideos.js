import { readPool } from '../../../database/index.js';

export async function getRecommendedVideosInternal(videoId, userId, limit = 10, page = 1) {
  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

  const sql = `
    WITH current_video AS (
      SELECT
        COALESCE(v.tags, '{}')::text[]               AS tags,
        COALESCE(array_agg(vc.category_id), '{}')::uuid[] AS category_ids
      FROM videos v
      LEFT JOIN video_categories vc ON vc.video_id = v.id
      WHERE v.id = $1
      GROUP BY v.id
    ),
    target_cats AS (
      -- categories of each candidate video (array)
      SELECT v.id,
             COALESCE(array_agg(vc.category_id), '{}')::uuid[] AS cats
      FROM videos v
      LEFT JOIN video_categories vc ON vc.video_id = v.id
      GROUP BY v.id
    )
    SELECT
      v.id,
      v.title,
      v.thumbnail_url,
      v.duration_seconds,
      v.view_count,
      v.created_at,
      u.full_name AS uploader_name,
      ${userId ? 'wp.progress_seconds,' : ''}
      ${userId ? 'wp.percentage_watched,' : ''}
      (
        -- tags overlap * 2
        COALESCE(
          array_length(
            ARRAY(
              SELECT DISTINCT t
              FROM unnest(COALESCE(v.tags, '{}')::text[]) AS t
              INTERSECT
              SELECT DISTINCT t2
              FROM unnest(cv.tags) AS t2
            ), 1
          ),
          0
        ) * 2
        +
        -- +3 if any category overlaps
        CASE WHEN tc.cats && cv.category_ids THEN 3 ELSE 0 END
      ) AS similarity_score,
      COALESCE(ppl.people, '[]'::json) AS people
    FROM videos v
    CROSS JOIN current_video cv
    JOIN target_cats tc ON tc.id = v.id
    LEFT JOIN users u ON v.uploaded_by = u.id
    ${userId ? 'LEFT JOIN watch_progress wp ON (wp.user_id = $4 AND wp.video_id = v.id)' : ''}
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
    WHERE v.id <> $1
      AND v.mux_status = 'ready' AND v.visibility = 'public'
      AND v.published_at IS NOT NULL
      AND (
        (COALESCE(v.tags, '{}')::text[] && cv.tags)
        OR (tc.cats && cv.category_ids)
      )
    ORDER BY similarity_score DESC, v.view_count DESC
    LIMIT $2 OFFSET $3;
  `;
  const { rows } = userId
    ? await readPool.query(sql, [videoId, limit, offset, userId])
    : await readPool.query(sql, [videoId, limit, offset]);
  return rows;
}
