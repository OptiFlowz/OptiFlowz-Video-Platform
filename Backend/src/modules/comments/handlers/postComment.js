import { readPool, writePool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';
import { moderateText } from '../../../common/moderateText.js';
import { watchableVideoWhere } from '../../../common/videoAccess.js';
import { HttpError } from '../../../common/httpError.js';

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

  if (parent_id) {
    const parentCheck = await readPool.query(
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
      SELECT v.id, $2, $3, $4 FROM public.videos v
      WHERE v.id = $1 AND ${watchableVideoWhere({ allowLiveRecording: true })}
      RETURNING
        id, video_id, user_id, parent_id, content,
        like_count, dislike_count, reply_count,
        created_at, updated_at
    `,
    [video_id, userId, parent_id, content]
  );

  if (!insertRes.rowCount) throw new HttpError(404, { message: 'Video not found' });
  return insertRes.rows[0];
}
