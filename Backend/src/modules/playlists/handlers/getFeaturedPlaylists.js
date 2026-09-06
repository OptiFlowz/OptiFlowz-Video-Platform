import { readPool } from '../../../database/index.js';

export async function getFeaturedPlaylistsInternal() {
  const sql = `
    SELECT
      p.id,
      p.title,
      COALESCE(p.thumbnail_url, fv.first_video_thumbnail_url) AS thumbnail_url,
      p.view_count,
      ic.video_count,
      p.created_at
    FROM public.playlists p
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
    WHERE p.status = 'public'
      AND p.featured = TRUE
    ORDER BY p.created_at ASC;
  `;

  const { rows } = await readPool.query(sql);
  return { playlists: rows };
}
