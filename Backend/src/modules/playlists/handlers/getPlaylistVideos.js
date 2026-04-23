import { readPool } from '../../../database/index.js';
import {
  buildVideoCardSelect,
  buildVideoCardJoins,
  buildVideoCardVisibilityWhere,
} from '../../../database/sql/videoCardFragments.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';

function prerequisites(object) {
  const schema = z.object({
    id: z.string().min(1, 'Playlist ID is required'),
    sortBy: z.enum(['position', 'created_at', 'view_count']).optional().default('position'),
    sortOrder: z.enum(['asc', 'desc']).optional().default('asc'),
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(12),
  });

  return validateOrThrow(schema.safeParse(object));
}

export async function getPlaylistVideosInternal(object, userId = null) {
  const { id, sortBy, sortOrder, page, limit } = prerequisites(object);
  const offset = (page - 1) * limit;

  const allowedSortFields = {
    position: 'pi.position',
    created_at: 'v.created_at',
    view_count: 'v.view_count',
  };

  const orderByField = allowedSortFields[sortBy];
  const orderByDirection = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  const values = [id, limit, offset, userId];

  const query = `
    ${buildVideoCardSelect({ includeWatchProgress: userId != null })}
    ${buildVideoCardJoins({
      includeWatchProgress: userId != null,
      watchProgressUserParam: '$4',
    })}
    JOIN playlist_items pi ON pi.video_id = v.id
    JOIN playlists pl ON pi.playlist_id = pl.id
    WHERE
      ${buildVideoCardVisibilityWhere()}
      AND pi.playlist_id = $1
      AND (
        pl.status = 'public'
        OR (
          pl.status = 'private'
          AND pl.created_by = $4
        )
      )
    ORDER BY ${orderByField} ${orderByDirection}
    LIMIT $2 OFFSET $3
  `;

  const countQuery = `
    SELECT COUNT(*)::int AS total
    FROM videos v
    JOIN playlist_items pi ON pi.video_id = v.id
    JOIN playlists pl ON pi.playlist_id = pl.id
    WHERE
      ${buildVideoCardVisibilityWhere()}
      AND pi.playlist_id = $1
      AND (
        pl.status = 'public'
        OR (
          pl.status = 'private'
          AND pl.created_by = $2
        )
      )
  `;

  const [videosResult, countResult] = await Promise.all([
    readPool.query(query, values),
    readPool.query(countQuery, [id, userId]),
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