import { writePool } from '../../../database/index.js';
import { validateOrThrow } from '../../../common/input.validation.js';
import { HttpError } from '../../../common/httpError.js';
import { postIdSchema, editPostSchema, POST_COLUMNS, requirePostUser } from '../helpers/posts.shared.js';
import { requireEditablePost } from '../helpers/postAccess.js';

export async function editPostInternal(params, body, userId, authorization) {
  requirePostUser(userId);
  const { postId } = validateOrThrow(postIdSchema.safeParse(params));
  const data = validateOrThrow(editPostSchema.safeParse(body));
  const client = await writePool.connect();
  try {
    await client.query('BEGIN');
    await requireEditablePost(client, postId, userId, authorization, true);
    if (data.block_order) {
      const { rows: blocks } = await client.query('SELECT id, position FROM public.post_blocks WHERE post_id = $1 FOR UPDATE', [postId]);
      const ids = new Set(blocks.map(block => block.id));
      const order = data.block_order.map(id => id.toLowerCase());
      if (order.length !== ids.size || new Set(order).size !== ids.size || order.some(id => !ids.has(id))) {
        throw new HttpError(409, { message: 'The post sections changed. Reload the post before reordering.' });
      }
      // Move out of the existing range first: the position constraint is immediate.
      const offset = Math.max(0, ...blocks.map(block => block.position)) + blocks.length + 1;
      await client.query('UPDATE public.post_blocks SET position = position + $2 WHERE post_id = $1', [postId, offset]);
      await client.query(`UPDATE public.post_blocks b SET position = ordering.position::int - 1
        FROM unnest($2::uuid[]) WITH ORDINALITY AS ordering(id, position)
        WHERE b.post_id = $1 AND b.id = ordering.id`, [postId, order]);
    }
    const { rows } = await client.query(`UPDATE public.posts
      SET title = COALESCE($2, title), status = COALESCE($3, status)
      WHERE id = $1 RETURNING ${POST_COLUMNS}`, [postId, data.title ?? null, data.status ?? null]);
    await client.query('COMMIT');
    return rows[0];
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}
