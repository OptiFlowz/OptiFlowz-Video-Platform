export function buildPlaylistCardSelect({ includeDescription = false } = {}) {
  return `
    SELECT
      p.id,
      p.title,
      ${includeDescription ? 'p.description,' : ''}
      p.thumbnail_url,
      p.view_count,
      ic.video_count,
      p.created_at,
      p.status
  `;
}

export function buildPlaylistCardJoins() {
  return `
    FROM public.playlists p
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS video_count
      FROM public.playlist_items pi3
      JOIN public.videos v3 ON v3.id = pi3.video_id
      WHERE pi3.playlist_id = p.id
        AND v3.mux_status = 'ready' AND v3.visibility = 'public'
        AND v3.published_at <= NOW()
    ) ic ON TRUE
  `;
}

export function buildPlaylistCardVisibilityWhere() {
  return `
    p.status = 'public'
  `;
}