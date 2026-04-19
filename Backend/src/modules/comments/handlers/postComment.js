import { writePool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';
import { moderateText } from '../../../common/moderateText.js';

function prerequisites(object, userId) {
  const schema = z.object({
    video_id: z.string().uuid('Invalid video id'),
    parent_id: z.string().uuid('Invalid parent id').nullable().optional(),
    content: z.string().trim().min(1).max(500),
  }).strict();

  if (!userId) {
    const error = new Error('Unauthorized');
    error.status = 401;
    throw error;
  }

  const textModeration = moderateText(object.content)

  if(!textModeration.allowed)
  {
    const error = new Error(textModeration.reason);
    error.status = 403;
    throw error;
  }

  return validateOrThrow(schema.safeParse(object));
}

export async function postCommentInternal(object, userId) { 
  const { video_id, parent_id = null, content } = prerequisites(object,userId);

  const videoCheck = await writePool.query(
    `SELECT id FROM public.videos WHERE id = $1 LIMIT 1`,
    [video_id]
  );

  if (videoCheck.rowCount === 0) {
    const error = new Error('Video not found');
    error.status = 404;
    throw error;
  }

  if (parent_id) {
    const parentCheck = await writePool.query(
      `SELECT id, video_id
       FROM public.video_comments
       WHERE id = $1 AND video_id = $2 AND is_deleted=false
       LIMIT 1`,
      [parent_id, video_id]
    );

    if (parentCheck.rowCount === 0) {
      const error = new Error('Parent comment not found');
      error.status = 404;
      throw error;
    }
  }

  const insertRes = await writePool.query(
    `
      INSERT INTO public.video_comments (video_id, user_id, parent_id, content)
      VALUES ($1, $2, $3, $4)
      RETURNING
        id, video_id, user_id, parent_id, content,
        like_count, dislike_count, reply_count,
        created_at, updated_at
    `,
    [video_id, userId, parent_id, content]
  );

  return insertRes.rows[0];
}