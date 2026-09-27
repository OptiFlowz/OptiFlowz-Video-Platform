import { pageReadySql, recordingReadySql } from '../../../../common/videoEligibility.js';
import { withVideoCardMedia } from '../../helpers/videoCardMedia.js';
import { readPool } from '../../../../database/index.js';
import { HttpError } from '../../../../common/httpError.js';

export async function getLikedVideosInternal({ query: queryParams, allowedKinds = ['upload', 'live'] }, actorUserId = null) {
  try {
    const { limit = 20, page = 1 } = queryParams;

    const query = `
            SELECT 
                v.id, v.kind,
                v.title,
                v.thumbnail_url,
                v.duration_seconds,
                v.view_count,
                v.created_at,
                vr.created_at as liked_at,
                u.full_name as uploader_name,
                wp.progress_seconds,
                wp.percentage_watched,
                COALESCE(ppl.people, '[]'::json) AS people
            FROM video_reactions vr
            JOIN videos v ON vr.video_id = v.id
            LEFT JOIN users u ON v.uploaded_by = u.id
            LEFT JOIN watch_progress wp
                ON (wp.user_id = $1 AND wp.video_id = v.id)
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
            WHERE vr.user_id = $1
            AND vr.reaction = 1
            AND ${pageReadySql()} AND v.kind = ANY($4::text[]) AND v.visibility = 'public' AND v.published_at <= NOW()
            ORDER BY vr.created_at DESC
            LIMIT $2 OFFSET $3
        `;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const { rows } = await readPool.query(query, [
      actorUserId,
      Math.min(parseInt(limit), 100),
      offset,
      allowedKinds,
    ]);

    return {
      videos: await withVideoCardMedia(rows, actorUserId, { includeLivestreams: true }),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
      },
    };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error('Liked videos error:', error);
    throw new HttpError(500, { message: 'Failed to fetch liked videos' });
  }
}
