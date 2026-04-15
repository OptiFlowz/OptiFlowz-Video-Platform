import { writePool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';

function prerequisites(object) {
  const schema = z.object({
    commentId: z.string().uuid('Invalid comment id'),
    userId: z.string().min(1, 'Unauthorized'),
    reaction: z.enum(['like', 'dislike']),
  });

  if (!object.userId) {
    const error = new Error('Unauthorized');
    error.status = 401;
    throw error;
  }
  
  return validateOrThrow(schema.safeParse(object));
}

export async function setCommentReactionInternal(commentId, userId, reaction) {
  const { commentId: validCommentId, userId: validUserId, reaction: validReaction } = prerequisites({ commentId, userId, reaction });

  const client = await writePool.connect();
  const newVal = validReaction === 'like' ? 1 : -1;

  try {
    await client.query('BEGIN');

    const commentCheck = await client.query(
      `
        SELECT id
        FROM public.video_comments
        WHERE id = $1 AND is_deleted = false
        LIMIT 1
      `,
      [validCommentId]
    );

    if (commentCheck.rowCount === 0) {
      const error = new Error('Comment not found');
      error.status = 404;
      throw error;
    }

    const { rows } = await client.query(
      `
        SELECT reaction
        FROM public.comment_reactions
        WHERE comment_id = $1 AND user_id = $2
        FOR UPDATE
      `,
      [validCommentId, validUserId]
    );

    let status;

    if (rows.length === 0) {
      await client.query(
        `
          INSERT INTO public.comment_reactions (comment_id, user_id, reaction)
          VALUES ($1, $2, $3)
        `,
        [validCommentId, validUserId, newVal]
      );

      if (newVal === 1) {
        await client.query(
          `UPDATE public.video_comments SET like_count = like_count + 1 WHERE id = $1`,
          [validCommentId]
        );
        status = 1;
      } else {
        await client.query(
          `UPDATE public.video_comments SET dislike_count = dislike_count + 1 WHERE id = $1`,
          [validCommentId]
        );
        status = -1;
      }
    } else {
      const oldVal = rows[0].reaction;

      if (oldVal === newVal) {
        await client.query(
          `DELETE FROM public.comment_reactions WHERE comment_id = $1 AND user_id = $2`,
          [validCommentId, validUserId]
        );

        if (newVal === 1) {
          await client.query(
            `UPDATE public.video_comments SET like_count = GREATEST(like_count - 1, 0) WHERE id = $1`,
            [validCommentId]
          );
        } else {
          await client.query(
            `UPDATE public.video_comments SET dislike_count = GREATEST(dislike_count - 1, 0) WHERE id = $1`,
            [validCommentId]
          );
        }

        status = 0;
      } else {
        await client.query(
          `
            UPDATE public.comment_reactions
            SET reaction = $3
            WHERE comment_id = $1 AND user_id = $2
          `,
          [validCommentId, validUserId, newVal]
        );

        if (newVal === 1) {
          await client.query(
            `
              UPDATE public.video_comments
              SET like_count = like_count + 1,
                  dislike_count = GREATEST(dislike_count - 1, 0)
              WHERE id = $1
            `,
            [validCommentId]
          );
          status = 1;
        } else {
          await client.query(
            `
              UPDATE public.video_comments
              SET dislike_count = dislike_count + 1,
                  like_count = GREATEST(like_count - 1, 0)
              WHERE id = $1
            `,
            [validCommentId]
          );
          status = -1;
        }
      }
    }

    const countsRes = await client.query(
      `SELECT like_count, dislike_count FROM public.video_comments WHERE id = $1`,
      [validCommentId]
    );

    await client.query('COMMIT');

    return {
      status,
      like_count: countsRes.rows[0]?.like_count ?? 0,
      dislike_count: countsRes.rows[0]?.dislike_count ?? 0,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}