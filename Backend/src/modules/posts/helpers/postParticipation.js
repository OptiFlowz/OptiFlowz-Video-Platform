import { writePool } from '../../../database/index.js';
import { validateOrThrow } from '../../../common/input.validation.js';
import { HttpError } from '../../../common/httpError.js';
import { hasPermission, loadAuthorization } from '../../authorization/authorization.service.js';
import { Permissions } from '../../authorization/permission.constants.js';
import { postBlockIdSchema, postResponseSchema, requirePostUser } from './posts.shared.js';
import { lockBlockOptions, findBlockOption, requireCorrectOption } from './postMutations.js';

const PARTICIPATION_PERMISSIONS = {
  poll: Permissions.POSTS_POLL_VOTE,
  questioner: Permissions.POSTS_QUESTIONER_ANSWER,
};

export async function withPostParticipation(params, body, userId, authorization, type, participate) {
  requirePostUser(userId);
  const { postId, blockId } = validateOrThrow(postBlockIdSchema.safeParse(params));
  const { option_id } = validateOrThrow(postResponseSchema.safeParse(body));
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
    const option = findBlockOption(storage.options, option_id);
    requireCorrectOption(block, storage.options);

    await participate({ client, block, storage, option });
    const result = await getParticipationResults(client, block, storage, option);
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

async function getParticipationResults(client, block, storage, selectedOption) {
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
      percentage: total ? Math.round(count / total * 10000) / 100 : 0,
      is_selected: option.id === selectedOption.id,
      ...(isQuestioner ? { is_correct: option.is_correct } : {}),
    };
  });
  return {
    post_id: block.post_id,
    block_id: block.id,
    selected_option_id: selectedOption.id,
    [isQuestioner ? 'total_answers' : 'total_votes']: total,
    options,
    ...(isQuestioner ? {
      is_correct: selectedOption.is_correct,
      correct_option_ids: storage.options.filter(option => option.is_correct).map(option => option.id),
    } : {}),
  };
}
