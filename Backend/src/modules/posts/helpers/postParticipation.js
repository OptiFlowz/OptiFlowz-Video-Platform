import { writePool } from '../../../database/index.js';
import { validateOrThrow } from '../../../common/input.validation.js';
import { HttpError } from '../../../common/httpError.js';
import { hasPermission, loadAuthorization } from '../../authorization/authorization.service.js';
import { Permissions } from '../../authorization/permission.constants.js';
import { postBlockIdSchema, questionerAnswerSchema, pollVoteSchema, requirePostUser } from './posts.shared.js';
import { lockBlockOptions, findBlockOption, requireCorrectOption } from './postMutations.js';

const PARTICIPATION_PERMISSIONS = {
  poll: Permissions.POSTS_POLL_VOTE,
  questioner: Permissions.POSTS_QUESTIONER_ANSWER,
};

export async function withPostParticipation(params, body, userId, authorization, type, participate) {
  requirePostUser(userId);
  const { postId, blockId } = validateOrThrow(postBlockIdSchema.safeParse(params));
  const data = validateOrThrow((type === 'poll' ? pollVoteSchema : questionerAnswerSchema).safeParse(body));
  const optionIds = data.option_ids || [data.option_id];
  const client = await writePool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    const access = authorization || await loadAuthorization(userId, client);
    if (!hasPermission(access, PARTICIPATION_PERMISSIONS[type])) {
      throw new HttpError(403, { message: 'Insufficient permissions' });
    }
    // Match editing/deletion lock order. Separate statements after this lock
    // see responses committed by any request that was previously holding it.
    const { rows: posts } = await client.query(
      'SELECT id, user_id, status FROM public.posts WHERE id = $1 FOR UPDATE',
      [postId],
    );
    const post = posts[0];
    if (!post || (post.status !== 'public'
      && post.user_id.toLowerCase() !== userId.toLowerCase()
      && !hasPermission(access, Permissions.POSTS_UPDATE_ANY))) {
      throw new HttpError(404, { message: 'Post not found' });
    }
    const { rows: blocks } = await client.query(
      'SELECT id, post_id, type FROM public.post_blocks WHERE id = $1 AND post_id = $2 FOR UPDATE',
      [blockId, post.id],
    );
    const block = blocks[0];
    if (!block) throw new HttpError(404, { message: 'Post block not found' });
    if (block.type !== type) throw new HttpError(400, { message: `This route requires a ${type} block` });
    const storage = await lockBlockOptions(client, block);
    const selectedOptions = optionIds.map(id => findBlockOption(storage.options, id));
    const option = selectedOptions[0];
    if (type === 'questioner' && storage.options.filter(item => item.is_correct).length === 1 && selectedOptions.length !== 1) {
      throw new HttpError(400, { message: 'This questioner accepts one answer' });
    }
    requireCorrectOption(block, storage.options);

    const selection = await participate({ client, block, storage, option, selectedOptions, remove: data.remove === true });
    const result = await getParticipationResults(client, block, storage, selection === null ? [] : selectedOptions);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(rollbackError => {
      console.warn('Post participation rollback failed:', rollbackError?.message || rollbackError);
    });
    throw error;
  } finally {
    client.release();
  }
}

async function getParticipationResults(client, block, storage, selectedOptions) {
  const selectedIds = selectedOptions.map(option => option.id);
  // LEFT JOIN includes choices that have no votes/answers. Only counts are
  // returned; participant identities are never exposed.
  const { rows: counts } = await client.query(
    `SELECT o.id, COUNT(r.user_id)::int AS response_count
     FROM ${storage.table} o
     LEFT JOIN ${storage.responses} r ON r.option_id = o.id
     WHERE o.block_id = $1 GROUP BY o.id ORDER BY o.id`,
    [block.id],
  );
  const countsById = new Map(counts.map(row => [row.id, row.response_count]));
  const total = counts.reduce((sum, row) => sum + row.response_count, 0);
  const isQuestioner = block.type === 'questioner';
  const options = storage.options.map(option => {
    const count = countsById.get(option.id) || 0;
    return {
      id: option.id,
      text: option.text,
      image_url: option.image_url,
      [isQuestioner ? 'answer_count' : 'vote_count']: count,
      is_selected: selectedIds.includes(option.id),
      ...(isQuestioner && selectedIds.length ? { is_correct: option.is_correct } : {}),
    };
  });
  return {
    post_id: block.post_id,
    block_id: block.id,
    selected_option_id: selectedIds.length === 1 ? selectedIds[0] : null,
    selected_option_ids: selectedIds,
    has_responses: total > 0,
    [isQuestioner ? 'total_answers' : 'total_votes']: total,
    options,
    ...(isQuestioner && selectedIds.length ? {
      is_correct: storage.options.every(option => option.is_correct === selectedIds.includes(option.id)),
      correct_option_ids: storage.options.filter(option => option.is_correct).map(option => option.id),
    } : {}),
  };
}
