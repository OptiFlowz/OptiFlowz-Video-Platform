import { writePool } from '../../../database/index.js';
import { COMMENT_SELECT } from './postComments.shared.js';

export async function listComments(postId, parentId, userId, { page, limit, sortBy, sortOrder }) {
  const direction = sortOrder === 'asc' ? 'ASC' : 'DESC';
  const order = sortBy === 'like_count'
    ? `like_count ${direction}, created_at ${direction}, id ${direction}`
    : `created_at ${direction}, id ${direction}`;
  const { rows } = await writePool.query(
    `WITH comment_page AS (
       SELECT ${COMMENT_SELECT}
       FROM public.post_comments c
       JOIN public.users u ON u.id = c.user_id
       LEFT JOIN public.post_comment_reactions cr ON cr.comment_id = c.id AND cr.user_id = $3::uuid
       WHERE c.post_id = $1 AND c.parent_id IS NOT DISTINCT FROM $2::uuid AND c.is_deleted = false
       ORDER BY ${order} LIMIT $4 OFFSET $5
     )
     SELECT
       (SELECT COUNT(*)::int FROM public.post_comments c
        WHERE c.post_id = $1 AND c.parent_id IS NOT DISTINCT FROM $2::uuid AND c.is_deleted = false) AS total,
       COALESCE((SELECT jsonb_agg(to_jsonb(comment_page) ORDER BY ${order}) FROM comment_page), '[]'::jsonb) AS comments`,
    [postId, parentId, userId, limit, (page - 1) * limit],
  );
  return rows[0];
}
