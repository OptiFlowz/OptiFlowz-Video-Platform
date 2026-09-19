import { writePool } from '../../../database/index.js';
import { validateOrThrow } from '../../../common/input.validation.js';
import { postIdSchema, requirePostUser } from '../helpers/posts.shared.js';
import { requireDeletablePost } from '../helpers/postAccess.js';
import { getPostImageObjects, deletePostImages } from '../helpers/postImages.js';

export async function deletePostInternal(params, userId, authorization) {
  requirePostUser(userId);
  const { postId } = validateOrThrow(postIdSchema.safeParse(params));
  const client = await writePool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    // Serialize deletion with all block and option mutations on this post.
    await requireDeletablePost(client, postId, userId, authorization, true);
    const { rows: images } = await client.query(
      `SELECT content->>'url' AS image_url
       FROM public.post_blocks WHERE post_id = $1 AND type = 'image'
       UNION ALL
       SELECT o.image_url FROM public.poll_options o
       JOIN public.post_blocks b ON b.id = o.block_id WHERE b.post_id = $1
       UNION ALL
       SELECT o.image_url FROM public.questioner_options o
       JOIN public.post_blocks b ON b.id = o.block_id WHERE b.post_id = $1`,
      [postId],
    );
    const objects = getPostImageObjects(postId, images.map(image => image.image_url));

    // Cascades remove blocks, options, votes and answers. Referenced videos remain.
    await client.query('DELETE FROM public.posts WHERE id = $1', [postId]);
    // Retain database references on storage failure so the request can be retried.
    await deletePostImages(objects);
    await client.query('COMMIT');
    return { deleted: true, post_id: postId };
  } catch (error) {
    await client.query('ROLLBACK').catch(rollbackError => {
      console.warn('Post deletion rollback failed:', rollbackError?.message || rollbackError);
    });
    throw error;
  } finally {
    client.release();
  }
}
