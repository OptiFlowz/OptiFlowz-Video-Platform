import { writePool } from '../../../database/index.js';
import { sendSuccess, sendError } from '../../../common/response.js';
import { z } from 'zod';

function prerequisites(object) {
  const schema = z.object({
    id: z.string().min(1, 'Channel ID is required'),
    sortBy: z.enum(['created_at', 'view_count']).optional().default('created_at'),
    sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(12),
  });

  return schema.safeParse(object);
}

export async function getChannelVideosInternal(object, userId = null) {
  const parsed = prerequisites(object);

  if (!parsed.success) {
    const error = new Error(parsed.error.issues[0]?.message || 'Invalid input');
    error.status = 400;
    throw error;
  }

  const { id, sortBy, sortOrder, page, limit } = parsed.data;
  const offset = (page - 1) * limit;

  const allowedSortFields = {
    created_at: 'v.created_at',
    view_count: 'v.view_count',
  };

  const orderByField = allowedSortFields[sortBy];
  const orderByDirection = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  const values = [id, limit, offset];
  let watchProgressJoin = '';
  let watchProgressSelect = '';

  if (userId) {
    values.push(userId);
    watchProgressJoin = `
      LEFT JOIN watch_progress wp
        ON (wp.user_id = $4 AND wp.video_id = v.id)
    `;
    watchProgressSelect = `
      wp.progress_seconds,
      wp.percentage_watched,
    `;
  }

  const query = `
    SELECT
      v.id,
      v.title,
      v.thumbnail_url,
      v.duration_seconds,
      v.view_count,
      v.created_at,
      u.full_name AS uploader_name,
      ${watchProgressSelect}
      COALESCE(ppl.people, '[]'::json) AS people
    FROM videos v
    LEFT JOIN users u
      ON v.uploaded_by = u.id
    ${watchProgressJoin}
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
    WHERE v.uploaded_by = $1
      AND v.mux_status = 'ready'
      AND v.visibility = 'public'
      AND v.published_at IS NOT NULL
    ORDER BY ${orderByField} ${orderByDirection}
    LIMIT $2 OFFSET $3
  `;

  const countQuery = `
    SELECT COUNT(*)::int AS total
    FROM videos v
    WHERE v.uploaded_by = $1
      AND v.mux_status = 'ready'
      AND v.visibility = 'public'
      AND v.published_at IS NOT NULL
  `;

  const [videosResult, countResult] = await Promise.all([
    writePool.query(query, values),
    writePool.query(countQuery, [id]),
  ]);

  const total = countResult.rows[0]?.total || 0;
  const totalPages = Math.ceil(total / limit);

  return {
    videos: videosResult.rows,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
    sorting: {
      sortBy,
      sortOrder,
    },
  };
}

export default async function getChannelVideos(req, res) {
  try {
    const result = await getChannelVideosInternal({...req.params, ...req.query,},req.user?.id || null);
    return sendSuccess(res,  result );
  } catch (error) {
    console.error('Error fetching channel videos:', error);
    return sendError(res);
  }
}