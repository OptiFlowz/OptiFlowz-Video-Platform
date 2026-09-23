import { writePool } from '../../../database/index.js';
import { validateOrThrow } from '../../../common/input.validation.js';
import { HttpError } from '../../../common/httpError.js';
import { moderateText } from '../../../common/moderateText.js';
import { requirePostUser } from '../../posts/helpers/posts.shared.js';
import { requireVisiblePost } from '../../posts/helpers/postAccess.js';
import { createCommentSchema, COMMENT_COLUMNS } from '../helpers/postComments.shared.js';

export async function postCommentInternal(body, userId, authorization) {
  requirePostUser(userId);
  const { post_id, parent_id = null, content } = validateOrThrow(createCommentSchema.safeParse(body));
  const moderation = moderateText(content);
  if (!moderation.allowed) throw new HttpError(403, { message: moderation.reason });
  const client = await writePool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await requireVisiblePost(client, post_id, userId, authorization, true);
    if (parent_id) {
      const { rows } = await client.query(
        `SELECT id FROM public.post_comments
         WHERE id = $1 AND post_id = $2 AND is_deleted = false FOR UPDATE`,
        [parent_id, post_id],
      );
      if (!rows.length) throw new HttpError(404, { message: 'Parent comment not found' });
    }
    const { rows } = await client.query(
      `INSERT INTO public.post_comments (post_id, user_id, parent_id, content)
       VALUES ($1, $2, $3, $4) RETURNING ${COMMENT_COLUMNS}`,
      [post_id, userId, parent_id, content],
    );
    await client.query('COMMIT');
    return rows[0];
  } catch (error) {
    await client.query('ROLLBACK').catch(rollbackError => {
      console.warn('Post comment rollback failed:', rollbackError?.message || rollbackError);
    });
    throw error;
  } finally {
    client.release();
  }
}
