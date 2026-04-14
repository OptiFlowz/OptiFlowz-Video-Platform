export function buildVideoCardSelect({ includeWatchProgress = false } = {}) {
  return `
    SELECT
      v.id,
      v.title,
      v.thumbnail_url,
      v.duration_seconds,
      v.view_count,
      v.created_at,
      u.full_name AS uploader_name,
      ${includeWatchProgress ? `
      wp.progress_seconds,
      wp.percentage_watched,
      ` : ''}
      COALESCE(ppl.people, '[]'::json) AS people
  `;
}

export function buildVideoCardJoins({ includeWatchProgress = false, watchProgressUserParam = null } = {}) {
  return `
    FROM videos v
    LEFT JOIN users u
      ON v.uploaded_by = u.id
    ${includeWatchProgress ? `
    LEFT JOIN watch_progress wp
      ON wp.user_id = ${watchProgressUserParam} AND wp.video_id = v.id
    ` : ''}
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
  `;
}

export function buildVideoCardVisibilityWhere() {
  return `
    v.mux_status = 'ready'
    AND v.visibility = 'public'
    AND v.published_at IS NOT NULL
  `;
}