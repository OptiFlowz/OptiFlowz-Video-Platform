import { validateOrThrow } from '../../../common/input.validation.js';
import { HttpError } from '../../../common/httpError.js';
import { postOptionIdSchema, editOptionSchemas, requirePostUser } from '../helpers/posts.shared.js';
import { withPostBlockMutation, lockBlockOptions, findBlockOption, requireNoBlockResponses, requireCorrectOption, saveOptionOrder } from '../helpers/postMutations.js';
import { validatePostImageFile, uploadPostImage, getPostImageObjects } from '../helpers/postImages.js';

export async function editPostOptionInternal(params, body, file, userId, authorization) {
  requirePostUser(userId);
  const ids = validateOrThrow(postOptionIdSchema.safeParse(params));
  if (file) validatePostImageFile(file);
  return withPostBlockMutation(ids, userId, authorization, async context => {
    const { client, block, uploadedObjects, oldImages } = context;
    const storage = await lockBlockOptions(client, block);
    const option = findBlockOption(storage.options, ids.optionId);
    const data = validateOrThrow(editOptionSchemas[block.type].safeParse(body));
    if (!file && data.text === undefined && data.is_correct === undefined && data.position === undefined) {
      throw new HttpError(400, { message: 'Provide an option field to update or an image file' });
    }
    await requireNoBlockResponses(client, block, storage);
    if (data.position !== undefined && data.position >= storage.options.length) {
      throw new HttpError(400, { message: 'Position must be an existing option index' });
    }
    const updated = {
      ...option,
      text: data.text ?? option.text,
      is_correct: data.is_correct ?? option.is_correct,
    };
    requireCorrectOption(block, storage.options.map(item => item.id === option.id ? updated : item));
    if (data.position !== undefined && data.position !== option.position) {
      const ordered = storage.options.filter(item => item.id !== option.id);
      ordered.splice(data.position, 0, option);
      await saveOptionOrder(client, block, storage, ordered);
    }
    if (file) {
      oldImages.push(...getPostImageObjects(block.post_id, [option.image_url]));
      updated.image_url = await uploadPostImage(block.post_id, file, uploadedObjects);
    }
    const values = [option.id, block.id, updated.text, updated.image_url];
    if (block.type === 'questioner') values.push(updated.is_correct);
    const { rows } = await client.query(
      `UPDATE ${storage.table} SET text = $3, image_url = $4${block.type === 'questioner' ? ', is_correct = $5' : ''}
       WHERE id = $1 AND block_id = $2 RETURNING ${storage.columns}`,
      values,
    );
    return rows[0];
  });
}
