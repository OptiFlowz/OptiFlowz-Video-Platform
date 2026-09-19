import { validateOrThrow } from '../../../common/input.validation.js';
import { HttpError } from '../../../common/httpError.js';
import { requireVisibleVideo } from '../../../common/videoAccess.js';
import { postBlockIdSchema, editBlockSchemas, BLOCK_COLUMNS, requirePostUser } from '../helpers/posts.shared.js';
import { withPostBlockMutation, lockBlockOptions, requireNoBlockResponses } from '../helpers/postMutations.js';
import { validatePostImageFile, uploadPostImage, getPostImageObjects } from '../helpers/postImages.js';

export async function editPostBlockInternal(params, body, file, userId, authorization) {
  requirePostUser(userId);
  const ids = validateOrThrow(postBlockIdSchema.safeParse(params));
  if (file) validatePostImageFile(file);
  return withPostBlockMutation(ids, userId, authorization, async context => {
    const { client, block, uploadedObjects, oldImages } = context;
    const data = validateOrThrow(editBlockSchemas[block.type].safeParse(body));
    if (file && block.type !== 'image') {
      throw new HttpError(400, { message: 'Only image blocks accept a file; edit option images through the option route' });
    }
    const updates = Object.fromEntries(
      Object.entries(data.content || {}).filter(([, value]) => value !== undefined),
    );
    if (!file && Object.keys(updates).length === 0) {
      throw new HttpError(400, { message: 'Provide content fields to update or a replacement image' });
    }
    if (block.type === 'poll' || block.type === 'questioner') {
      const storage = await lockBlockOptions(client, block);
      await requireNoBlockResponses(client, block, storage);
    }
    const content = { ...block.content, ...updates };
    if (block.type === 'image' && file) {
      oldImages.push(...getPostImageObjects(block.post_id, [block.content?.url]));
      content.url = await uploadPostImage(block.post_id, file, uploadedObjects);
    } else if (block.type === 'video' && updates.video_id !== undefined) {
      await requireVisibleVideo(client, content.video_id, userId);
    }
    const { rows } = await client.query(
      `UPDATE public.post_blocks SET content = $3::jsonb
       WHERE id = $1 AND post_id = $2 RETURNING ${BLOCK_COLUMNS}`,
      [block.id, block.post_id, JSON.stringify(content)],
    );
    return rows[0];
  });
}
