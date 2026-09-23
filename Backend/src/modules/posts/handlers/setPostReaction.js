import { writePool } from '../../../database/index.js';
import { validateOrThrow } from '../../../common/input.validation.js';
import { HttpError } from '../../../common/httpError.js';
import { postIdSchema, requirePostUser } from '../helpers/posts.shared.js';
import { hasPermission, loadAuthorization } from '../../authorization/authorization.service.js';
import { Permissions } from '../../authorization/permission.constants.js';

export async function setPostReactionInternal(params, userId, reaction, authorization) {
  requirePostUser(userId);
  const { postId } = validateOrThrow(postIdSchema.safeParse(params));
  if (reaction !== 'like' && reaction !== 'dislike') {
    throw new HttpError(400, { message: 'Invalid post reaction' });
  }
  const requested = reaction === 'like' ? 1 : -1;
  const client = await writePool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    const access = authorization || await loadAuthorization(userId, client);
    if (!hasPermission(access, Permissions.POSTS_REACT)) {
      throw new HttpError(403, { message: 'Insufficient permissions' });
    }

    // Lock the post even when no reaction exists yet. This serializes first
    // reactions, toggles, visibility changes, and deletion using the same order.
    const { rows: posts } = await client.query(
      'SELECT id, user_id, status FROM public.posts WHERE id = $1 FOR UPDATE',
      [postId],
    );
    const post = posts[0];
    if (!post || (post.status !== 'public'
      && post.user_id.toLowerCase() !== userId.toLowerCase()
      && !hasPermission(access, Permissions.POSTS_UPDATE_ANY))) {
      throw new HttpError(404, { message: 'Post not found' });
    }

    const { rows } = await client.query(
      'SELECT reaction FROM public.post_reactions WHERE post_id = $1 AND user_id = $2 FOR UPDATE',
      [post.id, userId],
    );
    const previous = rows[0]?.reaction ?? 0;
    const status = previous === requested ? 0 : requested;
    if (status === 0) {
      await client.query(
        'DELETE FROM public.post_reactions WHERE post_id = $1 AND user_id = $2',
        [post.id, userId],
      );
    } else {
      await client.query(
        `INSERT INTO public.post_reactions (post_id, user_id, reaction)
         VALUES ($1, $2, $3)
         ON CONFLICT (post_id, user_id)
         DO UPDATE SET reaction = EXCLUDED.reaction, created_at = NOW()`,
        [post.id, userId, status],
      );
    }
    await client.query(
      `UPDATE public.posts
       SET like_count = like_count + $2,
           dislike_count = dislike_count + $3
       WHERE id = $1`,
      [post.id, Number(status === 1) - Number(previous === 1),
        Number(status === -1) - Number(previous === -1)],
    );
    await client.query('COMMIT');
    return { status };
  } catch (error) {
    await client.query('ROLLBACK').catch(rollbackError => {
      console.warn('Post reaction rollback failed:', rollbackError?.message || rollbackError);
    });
    throw error;
  } finally {
    client.release();
  }
}
