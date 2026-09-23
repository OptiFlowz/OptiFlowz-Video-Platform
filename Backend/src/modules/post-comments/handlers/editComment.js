import { validateOrThrow } from '../../../common/input.validation.js';
import { HttpError } from '../../../common/httpError.js';
import { commentIdSchema, editCommentSchema, COMMENT_COLUMNS } from '../helpers/postComments.shared.js';
import { withPostCommentMutation } from '../helpers/postCommentAccess.js';

export async function editCommentInternal(params, body, userId, authorization) {
  const { id } = validateOrThrow(commentIdSchema.safeParse(params));
  const { content } = validateOrThrow(editCommentSchema.safeParse(body));
  return withPostCommentMutation(id, userId, authorization, async (client, comment) => {
    // As with video comments, content editing is reserved for its author.
    if (comment.user_id.toLowerCase() !== userId.toLowerCase()) {
      throw new HttpError(403, { message: 'You can only edit your own comment' });
    }
    const { rows } = await client.query(
      `UPDATE public.post_comments SET content = $2, updated_at = NOW()
       WHERE id = $1 RETURNING ${COMMENT_COLUMNS}`,
      [comment.id, content],
    );
    return rows[0];
  });
}
