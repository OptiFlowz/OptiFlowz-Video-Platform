import { HttpError } from '../../../common/httpError.js';
import { withPostParticipation } from '../helpers/postParticipation.js';

export function answerPostQuestionerInternal(params, body, userId, authorization) {
  return withPostParticipation(params, body, userId, authorization, 'questioner', async ({ client, block, selectedOptions }) => {
    const { rows: previousAnswers } = await client.query(
      `SELECT a.option_id FROM public.questioner_answers a
       JOIN public.questioner_options o ON o.id = a.option_id
       WHERE o.block_id = $1 AND a.user_id = $2`,
      [block.id, userId],
    );
    const selectedIds = selectedOptions.map(option => option.id);
    if (previousAnswers.length && (previousAnswers.length !== selectedIds.length
      || previousAnswers.some(answer => !selectedIds.includes(answer.option_id)))) {
      throw new HttpError(409, { message: 'You have already answered this questioner and cannot change your answer' });
    }
    // Retrying the same set of choices returns current results without changing the
    // recorded answer, its timestamp, or the total number of answers.
    if (previousAnswers.length) return;
    await client.query(
      'INSERT INTO public.questioner_answers (option_id, user_id) SELECT option_id, $2 FROM unnest($1::uuid[]) AS selected(option_id)',
      [selectedIds, userId],
    );
  });
}
