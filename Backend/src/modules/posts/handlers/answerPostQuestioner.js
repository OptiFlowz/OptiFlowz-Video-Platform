import { HttpError } from '../../../common/httpError.js';
import { withPostParticipation } from '../helpers/postParticipation.js';

export function answerPostQuestionerInternal(params, body, userId, authorization) {
  return withPostParticipation(params, body, userId, authorization, 'questioner', async ({ client, block, option }) => {
    const { rows: previousAnswers } = await client.query(
      `SELECT a.option_id FROM public.questioner_answers a
       JOIN public.questioner_options o ON o.id = a.option_id
       WHERE o.block_id = $1 AND a.user_id = $2`,
      [block.id, userId],
    );
    if (previousAnswers.some(answer => answer.option_id !== option.id)) {
      throw new HttpError(409, { message: 'You have already answered this questioner and cannot change your answer' });
    }
    // Retrying the same choice returns current results without changing the
    // recorded answer, its timestamp, or the total number of answers.
    if (previousAnswers.length) return;
    await client.query(
      'INSERT INTO public.questioner_answers (option_id, user_id) VALUES ($1, $2)',
      [option.id, userId],
    );
  });
}
