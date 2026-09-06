import { readPool } from '../../../database/index.js';

export async function getPlaylistWithVideosInternal(playlistId, userId = null) {
  const sql = `
    SELECT
      p.id,
      p.title,
      p.description,
      COALESCE(p.thumbnail_url, fv.first_video_thumbnail_url) AS thumbnail_url,
      p.view_count,
      p.save_count,
      COALESCE(ic.video_count, 0)::int AS video_count,
      p.created_at,
      p.tags,
      p.featured,
      ${
        userId
          ? `
        EXISTS (
          SELECT 1
          FROM public.playlist_saves ps
          WHERE ps.playlist_id = p.id
            AND ps.user_id = $2
        ) AS is_saved,
      `
          : `FALSE AS is_saved,`
      }
      COALESCE(vs.videos, '[]'::json) AS videos
    FROM public.playlists p

    LEFT JOIN LATERAL (
      SELECT v.thumbnail_url AS first_video_thumbnail_url
      FROM public.playlist_items pi
      JOIN public.videos v ON v.id = pi.video_id
      WHERE pi.playlist_id = p.id
        AND v.mux_status = 'ready'
        AND v.published_at IS NOT NULL
      ORDER BY pi.position ASC
      LIMIT 1
    ) fv ON TRUE

    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS video_count
      FROM public.playlist_items pi
      JOIN public.videos v ON v.id = pi.video_id
      WHERE pi.playlist_id = p.id
        AND v.mux_status = 'ready'
        AND v.published_at IS NOT NULL
    ) ic ON TRUE

    LEFT JOIN LATERAL (
      SELECT json_agg(
        json_build_object(
          'id', v.id,
          'title', v.title,
          'thumbnail_url', v.thumbnail_url,
          'duration_seconds', v.duration_seconds,
          'view_count', v.view_count,
          'created_at', v.created_at,
          'progress_seconds', ${userId ? 'wp.progress_seconds' : 'NULL'},
          'percentage_watched', ${userId ? 'wp.percentage_watched' : 'NULL'},
          'uploader_name', u.full_name,
          'people', COALESCE(ppl.people, '[]'::json)
        )
        ORDER BY pi.position ASC
      ) AS videos
      FROM public.playlist_items pi
      JOIN public.videos v ON v.id = pi.video_id
      LEFT JOIN public.users u ON u.id = v.uploaded_by
      ${userId ? 'LEFT JOIN public.watch_progress wp ON (wp.user_id = $2 AND wp.video_id = v.id)' : ''}
      LEFT JOIN LATERAL (
        SELECT json_agg(
          json_build_object(
            'id', p2.id,
            'name', p2.name,
            'image_url', p2.image_url
          )
          ORDER BY p2.name
        ) AS people
        FROM (
          SELECT DISTINCT p2.id, p2.name, p2.image_url
          FROM public.video_chairs vc
          JOIN public.people p2 ON p2.id = vc.person_id
          WHERE vc.video_id = v.id
        ) p2
      ) ppl ON TRUE
      WHERE pi.playlist_id = p.id
        AND v.mux_status = 'ready'
        AND v.published_at IS NOT NULL
    ) vs ON TRUE

    WHERE p.id = $1
    LIMIT 1;
  `;

  const params = userId ? [playlistId, userId] : [playlistId];
  const { rows } = await readPool.query(sql, params);

  return rows[0] || null;
}
