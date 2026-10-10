import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { HttpError } from '../../../../common/httpError.js';
import { questionIdSchema, requireQuestionUser } from '../helpers/questions.validation.js';
import { getQuestion } from '../repository/questions.repository.js';

export async function getQuestionInternal(params, userId) {
  requireQuestionUser(userId);
  const { questionId } = validateOrThrow(questionIdSchema.safeParse(params));
  const question = await getQuestion(writePool, questionId, userId);
  if (!question) throw new HttpError(404, { message: 'Question not found' });
  return question;
}
