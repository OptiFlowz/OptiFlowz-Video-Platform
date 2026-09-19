import { writePool } from '../../../database/index.js';
import { validateOrThrow } from '../../../common/input.validation.js';
import { HttpError } from '../../../common/httpError.js';
import { requireVisibleVideo } from '../../../common/videoAccess.js';
import {
  postIdSchema, postBlockSchema, requirePostUser, MAX_POST_BLOCKS, BLOCK_COLUMNS, OPTION_COLUMNS,
} from '../helpers/posts.shared.js';
import { requireEditablePost } from '../helpers/postAccess.js';
import { validateBlockFiles, uploadPostImage, cleanupPostImages } from '../helpers/postImages.js';

export async function appendPostBlockInternal(params, body, files = {}, userId, authorization) {
  requirePostUser(userId);
  const { postId } = validateOrThrow(postIdSchema.safeParse(params));
  const input = validateOrThrow(postBlockSchema.safeParse(body));
  validateBlockFiles(input, files);
  const uploadedObjects = [];
  const client = await writePool.connect();
  let commitStarted = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    // Serialize appends per post; recheck ownership after acquiring the lock.
    await requireEditablePost(client, postId, userId, authorization, true);
    const { rows: counts } = await client.query(
      `SELECT COUNT(*)::int AS total, COALESCE(MAX(position), -1) + 1 AS next_position
       FROM public.post_blocks WHERE post_id = $1`,
      [postId],
    );
    if (counts[0].total >= MAX_POST_BLOCKS) {
      throw new HttpError(409, { message: `A post can contain up to ${MAX_POST_BLOCKS} blocks` });
    }
    if (input.type === 'video') {
      await requireVisibleVideo(client, input.content.video_id, userId);
    }

    const content = input.type === 'image'
      ? { ...input.content, url: await uploadPostImage(postId, files.file[0], uploadedObjects) }
      : input.content;
    const { rows: blocks } = await client.query(
      `INSERT INTO public.post_blocks (post_id, type, position, content)
       VALUES ($1, $2, $3, $4::jsonb) RETURNING ${BLOCK_COLUMNS}`,
      [postId, input.type, counts[0].next_position, JSON.stringify(content)],
    );
    const block = blocks[0];

    if (input.options) {
      block.options = [];
      for (const [index, option] of input.options.entries()) {
        const file = files[`option_${index}`]?.[0];
        const imageUrl = file ? await uploadPostImage(postId, file, uploadedObjects) : null;
        const { rows } = input.type === 'poll'
          ? await client.query(
            `INSERT INTO public.poll_options (block_id, text, image_url)
             VALUES ($1, $2, $3) RETURNING ${OPTION_COLUMNS}`,
            [block.id, option.text, imageUrl],
          )
          : await client.query(
            `INSERT INTO public.questioner_options (block_id, text, image_url, is_correct)
             VALUES ($1, $2, $3, $4) RETURNING ${OPTION_COLUMNS}, is_correct`,
            [block.id, option.text, imageUrl, option.is_correct],
          );
        block.options.push(rows[0]);
      }
    }

    commitStarted = true;
    await client.query('COMMIT');
    return block;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.warn('Post block rollback failed:', rollbackError?.message || rollbackError);
    }
    // A lost COMMIT response may mean the block was saved. Retain its images.
    if (!commitStarted) await cleanupPostImages(uploadedObjects);
    throw error;
  } finally {
    client.release();
  }
}
