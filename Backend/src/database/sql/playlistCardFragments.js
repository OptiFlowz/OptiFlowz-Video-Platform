export function buildPlaylistCardSelect({ includeDescription = false } = {}) {
  return `
    SELECT
      p.id,
      p.title,
      ${includeDescription ? 'p.description,' : ''}
      COALESCE(p.thumbnail_url, fv.first_video_thumbnail_url) AS thumbnail_url,
      p.view_count,
      ic.video_count,
      p.created_at
  `;
}

export function buildPlaylistCardJoins() {
  return `
    FROM public.playlists p
    LEFT JOIN LATERAL (
      SELECT v.thumbnail_url AS first_video_thumbnail_url
      FROM public.playlist_items pi2
      JOIN public.videos v
        ON v.id = pi2.video_id
      WHERE pi2.playlist_id = p.id
      ORDER BY pi2.position ASC
      LIMIT 1
    ) fv ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS video_count
      FROM public.playlist_items pi3
      WHERE pi3.playlist_id = p.id
    ) ic ON TRUE
  `;
}

export function buildPlaylistCardVisibilityWhere() {
  return `
    p.status = 'public'
  `;
}