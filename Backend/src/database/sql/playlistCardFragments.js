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
      WHERE pi3.playlist_id = p.id
    ) ic ON TRUE
  `;
}

export function buildPlaylistCardVisibilityWhere() {
  return `
    p.status = 'public'
  `;
}