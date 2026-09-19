import { withPostParticipation } from '../helpers/postParticipation.js';

export function votePostPollInternal(params, body, userId, authorization) {
  return withPostParticipation(params, body, userId, authorization, 'poll', async ({ client, block, option, remove }) => {
    // Remove this user's selection only in this block, including any legacy
    // multiple selections. Removal/replacement and results are one transaction.
    await client.query(
      `DELETE FROM public.poll_votes v USING public.poll_options o
       WHERE v.option_id = o.id AND o.block_id = $1 AND v.user_id = $2`,
      [block.id, userId],
    );
    // Explicit removal is safe to retry: it can never re-add a vote.
    if (remove) return null;
    await client.query(
      'INSERT INTO public.poll_votes (option_id, user_id) VALUES ($1, $2)',
      [option.id, userId],
    );
  });
}
