import { writePool } from '../../../database/index.js';
import { HttpError } from '../../../common/httpError.js';
import { requirePostUser, BLOCK_COLUMNS, OPTION_COLUMNS } from './posts.shared.js';
import { requireEditablePost } from './postAccess.js';
import { cleanupPostImages, deletePostImages } from './postImages.js';

export async function withPostBlockMutation(ids, userId, authorization, mutate) {
  requirePostUser(userId);
  const client = await writePool.connect();
  const uploadedObjects = [];
  const oldImages = [];
  const removedImages = [];
  let commitStarted = false;
  let result;
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await requireEditablePost(client, ids.postId, userId, authorization, true);
    const { rows } = await client.query(
      `SELECT ${BLOCK_COLUMNS} FROM public.post_blocks
       WHERE id = $1 AND post_id = $2 FOR UPDATE`,
      [ids.blockId, ids.postId],
    );
    if (!rows.length) throw new HttpError(404, { message: 'Post block not found' });
    result = await mutate({ client, block: rows[0], uploadedObjects, oldImages, removedImages });
    // Explicit removals must succeed in storage before their references are lost.
    await deletePostImages(removedImages);
    commitStarted = true;
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(rollbackError => {
      console.warn('Post mutation rollback failed:', rollbackError?.message || rollbackError);
    });
    // An uncertain COMMIT may have saved the new image, so retain it in that case.
    if (!commitStarted) await cleanupPostImages(uploadedObjects);
    throw error;
  } finally {
    client.release();
  }
  // Replacement is committed. Failure here must not undo a successful edit.
  // Cleanup is immediate and best-effort; there is no worker or retry queue.
  await cleanupPostImages(oldImages);
  return result;
}

export function optionStorage(block) {
  if (block.type === 'poll') {
    return { table: 'public.poll_options', responses: 'public.poll_votes', columns: OPTION_COLUMNS };
  }
  if (block.type === 'questioner') {
    return { table: 'public.questioner_options', responses: 'public.questioner_answers', columns: `${OPTION_COLUMNS}, is_correct` };
  }
  throw new HttpError(400, { message: 'Only poll and questioner blocks have options' });
}

export async function lockBlockOptions(client, block) {
  const storage = optionStorage(block);
  // Lock every choice before checking responses. FK inserts for votes/answers
  // must finish first or wait, preventing a response-check/delete race.
  const { rows: options } = await client.query(
    `SELECT ${storage.columns} FROM ${storage.table} WHERE block_id = $1 ORDER BY id FOR UPDATE`,
    [block.id],
  );
  return { ...storage, options };
}

export async function requireNoBlockResponses(client, block, storage) {
  const { rows } = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM ${storage.responses} r
       JOIN ${storage.table} o ON o.id = r.option_id
       WHERE o.block_id = $1
     ) AS has_responses`,
    [block.id],
  );
  if (rows[0].has_responses) {
    throw new HttpError(409, { message: 'Questions and options cannot be changed after the block has responses' });
  }
}

export function findBlockOption(options, optionId) {
  const option = options.find(item => item.id.toLowerCase() === optionId.toLowerCase());
  if (!option) throw new HttpError(404, { message: 'Post option not found' });
  return option;
}

export function requireCorrectOption(block, options) {
  if (block.type === 'questioner' && !options.some(option => option.is_correct)) {
    throw new HttpError(409, { message: 'A questioner must retain at least one correct option' });
  }
}
