import { writePool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';

function prerequisites(object,userId) {
  const schema = z.object({
    id: z.string().uuid('Invalid comment id'),
  });

  if (!userId) {
    const error = new Error('Unauthorized');
    error.status = 401;
    throw error;
  }

  return validateOrThrow(schema.safeParse(object));
}

export async function deleteCommentInternal(params, userId, userRole) {
    console.log(params);
  const { id: commentId } = prerequisites(params,userId);
  const isAdmin = userRole === 'admin';

  const check = await writePool.query(
    `
      SELECT id, user_id, is_deleted
      FROM public.video_comments
      WHERE id = $1 AND is_deleted = false
      LIMIT 1
    `,
    [commentId]
  );

  if (check.rowCount === 0) {
    const error = new Error('Comment not found');
    error.status = 404;
    throw error;
  }

  const comment = check.rows[0];

  if (comment.is_deleted) {
    return { deleted: true };
  }

  const isOwner = comment.user_id === userId;

  if (!isOwner && !isAdmin) {
    const error = new Error('You can only delete your own comment (or be admin)');
    error.status = 403;
    throw error;
  }

  await writePool.query(
    `
      UPDATE public.video_comments
      SET is_deleted = true,
          updated_at = NOW()
      WHERE id = $1
    `,
    [commentId]
  );

  return { deleted: true };
}