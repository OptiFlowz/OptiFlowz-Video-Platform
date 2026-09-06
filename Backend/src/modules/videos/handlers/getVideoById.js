import { readPool } from '../../../database/index.js';

export async function getVideoByIdInternal(videoId, userId = null) {
  const query = `
        SELECT 
            v.id,
            v.mux_playback_id,
            v.title,
            v.description,
            v.thumbnail_url,
            v.duration_seconds,
            v.tags,
            v.view_count,
            v.like_count,
            v.dislike_count,
            v.created_at,
            v.updated_at,
            v.published_at,
            v.chapters,
            v.visibility,
            u.id as uploader_id,
            u.full_name as uploader_name,
            u.image_url as uploader_image,
            ${userId ? 'wp.progress_seconds, wp.percentage_watched,' : ''}
            ${userId ? 'COALESCE(vr.reaction, 0) as user_reaction,' : ''}
            CASE WHEN v.mux_playback_id IS NOT NULL 
                THEN $2 || v.mux_playback_id || '.m3u8' 
                ELSE NULL 
            END as stream_url
        FROM videos v
        LEFT JOIN users u ON v.uploaded_by = u.id
        ${userId ? 'LEFT JOIN watch_progress wp ON v.id = wp.video_id AND wp.user_id = $3' : ''}
        ${userId ? 'LEFT JOIN video_reactions vr ON v.id = vr.video_id AND vr.user_id = $3' : ''}
        WHERE v.id = $1 AND v.mux_status = 'ready' AND (v.visibility = 'public'  ${userId ? "OR (v.visibility = 'private' AND v.uploaded_by = $3)" : ''})
    `;

  const params = [videoId, 'https://stream.mux.com/'];
  if (userId) params.push(userId);

  const { rows } = await readPool.query(query, params);

  if (!rows.length) {
    return null;
  }

  // Inkrementiraj view count
  // if (userId) {
  //     await incrementViewCount(videoId, userId);
  // }

  const catq = `
    SELECT c.id, c.name, c.color
    FROM video_categories vc
    JOIN categories c ON vc.category_id = c.id
    WHERE vc.video_id = $1
  `;
  const { rows: catRows } = await readPool.query(catq, [videoId]);

  const chairq = `
    SELECT 
      p.id,
      p.name,
      p.image_url,
      vc.type,
      COUNT(vc_all.video_id) AS total_video_count
    FROM people p
    JOIN video_chairs vc ON p.id = vc.person_id
    JOIN video_chairs vc_all ON p.id = vc_all.person_id
	  JOIN videos vid ON vc_all.video_id = vid.id
    WHERE vc.video_id = $1 AND vid.mux_status = 'ready' AND vid.visibility = 'public'
    GROUP BY p.id, p.name, p.image_url, vc.type;
    `;
  const { rows: chairRows } = await readPool.query(chairq, [videoId]);

  const playlistq = `
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
      AND EXISTS (
        SELECT 1
        FROM public.playlist_items pi
        WHERE pi.playlist_id = p.id
          AND pi.video_id = $1
    );
  `;
  const { rows: playlistRows } = await readPool.query(playlistq, [videoId]);

  const countRes = await readPool.query(
    `
    SELECT COUNT(*)::int AS total
    FROM public.video_comments c
    LEFT JOIN public.video_comments p
      ON p.id = c.parent_id
    WHERE c.video_id = $1
      AND c.is_deleted = false
      AND (
        c.parent_id IS NULL
        OR (p.id IS NOT NULL AND p.is_deleted = false)
      );
    `,
    [videoId],
  );
  const total = countRes.rows[0]?.total || 0;

  rows[0].comment_count = total;
  rows[0].categories = catRows;
  rows[0].people = chairRows;
  rows[0].playlists = playlistRows;
  return rows[0];
}
