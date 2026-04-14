import { writePool } from '../../../database/index.js';
import { buildVideoCardSelect,buildVideoCardJoins,buildVideoCardVisibilityWhere } from '../../../database/sql/videoCardFragments.js';
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

  const values = 
  userId != null ? 
  [id, limit, offset, userId]: 
  [id, limit, offset];

  const query = `
      ${buildVideoCardSelect({ includeWatchProgress: userId != null })}
      ${buildVideoCardJoins({includeWatchProgress: userId != null,watchProgressUserParam: '$4'})}
      WHERE
        ${buildVideoCardVisibilityWhere()}
        AND v.uploaded_by = $1
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
