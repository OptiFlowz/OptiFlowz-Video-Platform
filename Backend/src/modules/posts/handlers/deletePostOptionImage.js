import { validateOrThrow } from '../../../common/input.validation.js';
import { postOptionIdSchema, requirePostUser } from '../helpers/posts.shared.js';
import { withPostBlockMutation, lockBlockOptions, findBlockOption, requireNoBlockResponses } from '../helpers/postMutations.js';
import { getPostImageObjects } from '../helpers/postImages.js';

export async function deletePostOptionImageInternal(params, userId, authorization) {
  requirePostUser(userId);
  const ids = validateOrThrow(postOptionIdSchema.safeParse(params));
  return withPostBlockMutation(ids, userId, authorization, async ({ client, block, removedImages }) => {
    const storage = await lockBlockOptions(client, block);
    const option = findBlockOption(storage.options, ids.optionId);
    if (!option.image_url) return option;
    await requireNoBlockResponses(client, block, storage);
    removedImages.push(...getPostImageObjects(block.post_id, [option.image_url]));
    const { rows } = await client.query(
      `UPDATE ${storage.table} SET image_url = NULL WHERE id = $1 AND block_id = $2 RETURNING ${storage.columns}`,
      [option.id, block.id],
    );
    return rows[0];
  });
}
