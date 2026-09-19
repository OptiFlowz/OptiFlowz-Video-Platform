import { validateOrThrow } from '../../../common/input.validation.js';
import { HttpError } from '../../../common/httpError.js';
import { postOptionIdSchema, requirePostUser } from '../helpers/posts.shared.js';
import { withPostBlockMutation, lockBlockOptions, findBlockOption, requireNoBlockResponses, requireCorrectOption, saveOptionOrder } from '../helpers/postMutations.js';
import { getPostImageObjects } from '../helpers/postImages.js';

export async function deletePostOptionInternal(params, userId, authorization) {
  requirePostUser(userId);
  const ids = validateOrThrow(postOptionIdSchema.safeParse(params));
  return withPostBlockMutation(ids, userId, authorization, async ({ client, block, removedImages }) => {
    const storage = await lockBlockOptions(client, block);
    const option = findBlockOption(storage.options, ids.optionId);
    await requireNoBlockResponses(client, block, storage);
    if (storage.options.length <= 2) {
      throw new HttpError(409, { message: 'A block must retain at least two options' });
    }
    requireCorrectOption(block, storage.options.filter(item => item.id !== option.id));
    removedImages.push(...getPostImageObjects(block.post_id, [option.image_url]));
    await client.query(`DELETE FROM ${storage.table} WHERE id = $1 AND block_id = $2`, [option.id, block.id]);
    await saveOptionOrder(client, block, storage, storage.options.filter(item => item.id !== option.id));
    return { deleted: true, option_id: option.id };
  });
}
