import { writePool } from '../../../database/index.js';
import { validateOrThrow } from '../../../common/input.validation.js';
import { HttpError } from '../../../common/httpError.js';
import { postBlockIdSchema, requirePostUser } from '../helpers/posts.shared.js';
import { requireEditablePost } from '../helpers/postAccess.js';
import { getPostImageObjects, deletePostImages } from '../helpers/postImages.js';

export async function deletePostBlockInternal(params, userId, authorization) {
  requirePostUser(userId);
  const { postId, blockId } = validateOrThrow(postBlockIdSchema.safeParse(params));
  const client = await writePool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    // Use the same post lock as append to serialize content changes.
    await requireEditablePost(client, postId, userId, authorization, true);
    const { rows: blocks } = await client.query(
      `SELECT id, type, content FROM public.post_blocks
       WHERE id = $1 AND post_id = $2 FOR UPDATE`,
      [blockId, postId],
    );
    const block = blocks[0];
    if (!block) throw new HttpError(404, { message: 'Post block not found' });

    const { rows: options } = await client.query(
      `SELECT image_url FROM public.poll_options WHERE block_id = $1
       UNION ALL
       SELECT image_url FROM public.questioner_options WHERE block_id = $1`,
      [blockId],
    );
    const imageUrls = options.map(option => option.image_url);
    if (block.type === 'image') imageUrls.push(block.content?.url);
    const objects = getPostImageObjects(postId, imageUrls);

    // Cascade options/votes/answers inside the transaction, retaining their URLs
    // on rollback if storage cleanup fails. No video assets are deleted.
    await client.query(
      'DELETE FROM public.post_blocks WHERE id = $1 AND post_id = $2',
      [blockId, postId],
    );
    await deletePostImages(objects);
    await client.query('COMMIT');
    return { deleted: true, block_id: blockId };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.warn('Post block deletion rollback failed:', rollbackError?.message || rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
}
