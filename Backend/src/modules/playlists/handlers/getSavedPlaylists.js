import { readPool } from '../../../database/index.js';

export async function getSavedPlaylistsInternal(userId, { limit = 50, offset = 0 } = {}) {
  const safeLimit = Math.min(parseInt(limit, 10) || 50, 100);
  const safeOffset = parseInt(offset, 10) || 0;

  const query = `
    SELECT
      p.id,
      p.title,
      COALESCE(p.thumbnail_url, fv.first_video_thumbnail_url) AS thumbnail_url,
      p.view_count,
      ic.video_count,
      p.created_at
    FROM public.playlist_saves sp
    JOIN public.playlists p ON p.id = sp.playlist_id
    LEFT JOIN LATERAL (
      SELECT v.thumbnail_url AS first_video_thumbnail_url
      FROM public.playlist_items pi2
      JOIN public.videos v ON v.id = pi2.video_id
      WHERE pi2.playlist_id = p.id
      ORDER BY pi2.position ASC
      LIMIT 1
    ) fv ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS video_count
      FROM public.playlist_items pi3
      WHERE pi3.playlist_id = p.id
    ) ic ON TRUE
    WHERE sp.user_id = $1
      AND p.status = 'public'
    ORDER BY sp.created_at DESC
    LIMIT $2 OFFSET $3;
  `;

  const { rows } = await readPool.query(query, [userId, safeLimit, safeOffset]);
  return { playlists: rows, limit: safeLimit, offset: safeOffset };
}
