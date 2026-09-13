import { withPlaylistCardMedia } from '../../helpers/playlistCardMedia.js';
import { readPool } from '../../../../database/index.js';

export async function getFeaturedPlaylistsInternal(userId = null) {
  const sql = `
    SELECT
      p.id,
      p.title,
      p.thumbnail_url,
      p.view_count,
      ic.video_count,
      p.created_at
    FROM public.playlists p
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
  return { playlists: await withPlaylistCardMedia(rows, userId) };
}
