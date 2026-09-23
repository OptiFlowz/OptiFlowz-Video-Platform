import { validateOrThrow } from '../../../common/input.validation.js';
import { commentIdSchema, reactionSchema } from '../helpers/postComments.shared.js';
import { withPostCommentMutation } from '../helpers/postCommentAccess.js';

export async function setCommentReactionInternal(commentId, userId, reaction, authorization) {
  const { id } = validateOrThrow(commentIdSchema.safeParse({ id: commentId }));
  const requested = validateOrThrow(reactionSchema.safeParse(reaction)) === 'like' ? 1 : -1;
  return withPostCommentMutation(id, userId, authorization, async (client, comment) => {
    const { rows } = await client.query(
      'SELECT reaction FROM public.post_comment_reactions WHERE comment_id = $1 AND user_id = $2 FOR UPDATE',
      [comment.id, userId],
    );
    const previous = rows[0]?.reaction ?? 0;
    const status = previous === requested ? 0 : requested;
    if (status === 0) {
      await client.query('DELETE FROM public.post_comment_reactions WHERE comment_id = $1 AND user_id = $2', [comment.id, userId]);
    } else {
      await client.query(
        `INSERT INTO public.post_comment_reactions (comment_id, user_id, reaction)
         VALUES ($1, $2, $3) ON CONFLICT (comment_id, user_id)
         DO UPDATE SET reaction = EXCLUDED.reaction`,
        [comment.id, userId, status],
      );
    }
    const { rows: counts } = await client.query(
      `UPDATE public.post_comments
       SET like_count = GREATEST(like_count + $2, 0),
           dislike_count = GREATEST(dislike_count + $3, 0)
       WHERE id = $1 RETURNING like_count, dislike_count`,
      [comment.id, Number(status === 1) - Number(previous === 1),
        Number(status === -1) - Number(previous === -1)],
    );
    return { status, ...counts[0] };
  });
}
