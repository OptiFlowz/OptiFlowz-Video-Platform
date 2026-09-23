import { writePool } from '../../../database/index.js';
import { HttpError } from '../../../common/httpError.js';
import { requirePostUser } from '../../posts/helpers/posts.shared.js';
import { requireVisiblePost } from '../../posts/helpers/postAccess.js';
import { COMMENT_COLUMNS } from './postComments.shared.js';

// Post first, then comment: the same lock order as other post mutations.
export async function withPostCommentMutation(commentId, userId, authorization, mutate) {
  requirePostUser(userId);
  const client = await writePool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    const { rows } = await client.query(
      'SELECT post_id FROM public.post_comments WHERE id = $1 AND is_deleted = false',
      [commentId],
    );
    if (!rows.length) throw new HttpError(404, { message: 'Comment not found' });
    await requireVisiblePost(client, rows[0].post_id, userId, authorization, true);
    const { rows: comments } = await client.query(
      `SELECT ${COMMENT_COLUMNS} FROM public.post_comments
       WHERE id = $1 AND post_id = $2 AND is_deleted = false FOR UPDATE`,
      [commentId, rows[0].post_id],
    );
    if (!comments.length) throw new HttpError(404, { message: 'Comment not found' });
    const result = await mutate(client, comments[0]);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(rollbackError => {
      console.warn('Post comment rollback failed:', rollbackError?.message || rollbackError);
    });
    throw error;
  } finally {
    client.release();
  }
}
