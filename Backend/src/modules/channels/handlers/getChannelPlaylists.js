import { writePool } from '../../../database/index.js';
import { buildPlaylistCardSelect,buildPlaylistCardJoins,buildPlaylistCardVisibilityWhere } from '../../../database/sql/playlistCardFragments.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';


function prerequisites(object) {
  const schema = z.object({
    id: z.string().min(1, 'Channel ID is required'),
    sortBy: z.enum(['created_at', 'view_count']).optional().default('created_at'),
    sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(12),
  });

  return validateOrThrow(schema.safeParse(object));
}

export async function getChannelPlaylistsInternal(object, userId = null) {
  const { id, sortBy, sortOrder, page, limit } = prerequisites(object);
  const offset = (page - 1) * limit;

  const allowedSortFields = {
    created_at: 'p.created_at',
    view_count: 'p.view_count',
  };

  const orderByField = allowedSortFields[sortBy];
  const orderByDirection = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  const values = 
  userId != null ? 
  [id, limit, offset, userId]: 
  [id, limit, offset];

  const query = `
      ${buildPlaylistCardSelect({ includeDescription: false})}
      ${buildPlaylistCardJoins()}
      WHERE
        ${ buildPlaylistCardVisibilityWhere()}
        AND p.created_by = $1
      ORDER BY ${orderByField} ${orderByDirection}
      LIMIT $2 OFFSET $3
  `;

  const countQuery = `
    SELECT COUNT(*)::int AS total
    FROM playlists p
    WHERE p.created_by = $1
      AND p.status = 'public'
  `;

  const [playlistsResult, countResult] = await Promise.all([
    writePool.query(query, values),
    writePool.query(countQuery, [id]),
  ]);

  const total = countResult.rows[0]?.total || 0;
  const totalPages = Math.ceil(total / limit);

  return {
    playlists: playlistsResult.rows,
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
