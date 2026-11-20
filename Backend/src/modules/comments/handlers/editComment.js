import { readPool, writePool } from '../../../database/index.js';
import { watchableVideoWhere } from '../../../common/videoAccess.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';

function prerequisites(params, body, userId) {
  const schema = z.object({
    id: z.string().uuid('Invalid comment id'),
    content: z.string().trim().min(1).max(2000),
  });

  if (!userId) {
    const error = new Error('Unauthorized');
    error.status = 401;
    throw error;
  }

  return validateOrThrow(
    schema.safeParse({
      id: params.id,
      content: body.content,
    })
  );
}

export async function editCommentInternal(params, body, userId) {
  const { id: commentId, content } = prerequisites(params, body, userId);

  const { rows, rowCount } = await writePool.query(
    `
      UPDATE public.video_comments AS c
      SET content = $1, updated_at = NOW()
      WHERE id = $2
        AND user_id = $3
        AND is_deleted = false
        AND EXISTS (SELECT 1 FROM public.videos v WHERE v.id = c.video_id
                    AND ${watchableVideoWhere({ userParam: '$3', allowLiveRecording: true })})
      RETURNING
        id, video_id, user_id, parent_id,
        content, like_count, dislike_count, reply_count,
        created_at, updated_at
    `,
    [content, commentId, userId]
  );

  if (rowCount > 0) {
    return rows[0];
  }

  const check = await readPool.query(
    `SELECT c.user_id, c.is_deleted FROM public.video_comments c
     JOIN public.videos v ON v.id = c.video_id
     WHERE c.id = $1 AND ${watchableVideoWhere({ allowLiveRecording: true })}`,
    [commentId, userId]
  );

  if (check.rowCount === 0) {
    const error = new Error('Comment not found');
    error.status = 404;
    throw error;
  }

  if (check.rows[0].is_deleted) {
    const error = new Error('Cannot edit deleted comment');
    error.status = 400;
    throw error;
  }

  if (check.rows[0].user_id !== userId) {
    const error = new Error('You can only edit your own comment');
    error.status = 403;
    throw error;
  }

  const error = new Error('Could not edit comment');
  error.status = 400;
  throw error;
}
