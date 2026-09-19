import { validateOrThrow } from '../../../common/input.validation.js';
import { HttpError } from '../../../common/httpError.js';
import { postBlockIdSchema, createOptionSchemas, MAX_BLOCK_OPTIONS, requirePostUser } from '../helpers/posts.shared.js';
import { withPostBlockMutation, lockBlockOptions, requireNoBlockResponses, requireCorrectOption } from '../helpers/postMutations.js';
import { validatePostImageFile, uploadPostImage } from '../helpers/postImages.js';

export async function addPostOptionInternal(params, body, file, userId, authorization) {
  requirePostUser(userId);
  const ids = validateOrThrow(postBlockIdSchema.safeParse(params));
  if (file) validatePostImageFile(file);
  return withPostBlockMutation(ids, userId, authorization, async ({ client, block, uploadedObjects }) => {
    const storage = await lockBlockOptions(client, block);
    const data = validateOrThrow(createOptionSchemas[block.type].safeParse(body));
    await requireNoBlockResponses(client, block, storage);
    if (storage.options.length >= MAX_BLOCK_OPTIONS) {
      throw new HttpError(409, { message: `A block can contain up to ${MAX_BLOCK_OPTIONS} options` });
    }
    requireCorrectOption(block, [...storage.options, data]);
    const imageUrl = file ? await uploadPostImage(block.post_id, file, uploadedObjects) : null;
    const params = [block.id, data.text, imageUrl];
    if (block.type === 'questioner') params.push(data.is_correct);
    const { rows } = await client.query(
      `INSERT INTO ${storage.table} (block_id, text, image_url${block.type === 'questioner' ? ', is_correct' : ''})
       VALUES ($1, $2, $3${block.type === 'questioner' ? ', $4' : ''}) RETURNING ${storage.columns}`,
      params,
    );
    return rows[0];
  });
}
