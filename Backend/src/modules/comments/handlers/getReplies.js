import { readPool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';

function prerequisites(object) {
  const schema = z.object({
    id: z.string().uuid('Invalid comment id'),
    sortBy: z.enum(['created_at', 'like_count']).optional().default('created_at'),
    sortOrder: z.enum(['asc', 'desc']).optional().default('asc'),
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  });

  return validateOrThrow(schema.safeParse(object));
}

export async function getRepliesInternal(object, userId = null) {
  const { id: parentId, sortBy, sortOrder, page, limit } = prerequisites(object);
  const offset = (page - 1) * limit;

  const allowedSortFields = {
    created_at: 'c.created_at',
    like_count: 'c.like_count',
  };

  const orderByField = allowedSortFields[sortBy];
  const orderByDirection = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  const parentRes = await readPool.query(
    `
      SELECT id, video_id
      FROM public.video_comments
      WHERE id = $1 AND is_deleted = false
      LIMIT 1
    `,
    [parentId]
  );

  if (parentRes.rowCount === 0) {
    const error = new Error('Parent comment not found');
    error.status = 404;
    throw error;
  }

  const video_id = parentRes.rows[0].video_id;

  const countRes = await readPool.query(
    `
      SELECT COUNT(*)::int AS total
      FROM public.video_comments c
      WHERE c.parent_id = $1
        AND c.is_deleted = false
    `,
    [parentId]
  );

  const total = countRes.rows[0]?.total || 0;

  const values =
    userId != null
      ? [parentId, userId, limit, offset]
      : [parentId, limit, offset];

  const query = `
    SELECT
      c.id,
      c.video_id,
      c.user_id,
      c.parent_id,
      c.content,
      c.like_count,
      c.dislike_count,
      c.reply_count,
      c.created_at,
      c.updated_at,
      u.full_name AS author_full_name,
      u.image_url AS author_image_url,
      ${userId != null ? 'cr.reaction AS my_reaction' : 'NULL AS my_reaction'}
    FROM public.video_comments c
    JOIN public.users u
      ON u.id = c.user_id
    ${
      userId != null
        ? `
    LEFT JOIN public.comment_reactions cr
      ON cr.comment_id = c.id AND cr.user_id = $2
    `
        : ''
    }
    WHERE c.parent_id = $1
      AND c.is_deleted = false
    ORDER BY ${orderByField} ${orderByDirection}
    LIMIT $${userId != null ? 3 : 2} OFFSET $${userId != null ? 4 : 3}
  `;

  const { rows } = await readPool.query(query, values);

  const totalPages = Math.ceil(total / limit);

  return {
    replies: rows,
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
    parent_id: parentId,
    video_id,
  };
}