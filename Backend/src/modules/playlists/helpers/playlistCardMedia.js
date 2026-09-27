import { writePool } from '../../../database/index.js';
import { withVideoThumbnailMedia } from '../../videos/helpers/videoCardMedia.js';

export async function withPlaylistCardMedia(cards, userId = null) {
  if (!cards.length) return [];
  // Re-read artwork and item order on the primary so removal/reordering takes
  // effect even when the playlist cards came from a replica.
  const { rows } = await writePool.query(
    `SELECT p.id, p.thumbnail_url, first_item.video_id
     FROM public.playlists p
     LEFT JOIN LATERAL (
       SELECT pi.video_id
       FROM public.playlist_items pi
       JOIN public.videos v ON v.id = pi.video_id
       WHERE pi.playlist_id = p.id
         AND v.mux_status = 'ready'
         AND ((v.visibility = 'public' AND v.published_at <= NOW())
           OR (v.visibility IN ('public', 'private') AND v.uploaded_by = $2))
       ORDER BY pi.position ASC, pi.video_id
       LIMIT 1
     ) first_item ON TRUE
     WHERE p.id = ANY($1::uuid[])`,
    [[...new Set(cards.map(card => card.id))], userId],
  );
  const playlists = new Map(rows.map(row => [row.id, row]));
  const videoIds = [...new Set(rows
    .filter(row => !row.thumbnail_url?.trim() && row.video_id)
    .map(row => row.video_id))];
  const thumbnails = new Map((await withVideoThumbnailMedia(
    videoIds.map(id => ({ id })), userId,
  )).map(video => [video.id, video]));

  return cards.map(card => {
    const playlist = playlists.get(card.id);
    const custom = playlist?.thumbnail_url?.trim() || null;
    const fallback = custom ? null : thumbnails.get(playlist?.video_id);
    return {
      ...card,
      thumbnail_url: custom || fallback?.thumbnail_url || null,
      media_expires_at: fallback?.media_expires_at ?? null,
    };
  });
}
