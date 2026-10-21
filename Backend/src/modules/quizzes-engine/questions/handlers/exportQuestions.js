import { writePool } from '../../../../database/index.js';
import { HttpError } from '../../../../common/httpError.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { requireQuestionUser } from '../helpers/questions.validation.js';
import { exportQuestionsSchema } from '../helpers/questionTransfer.validation.js';
import { exportMoodleXml } from '../helpers/moodleXml.js';
import { getExportQuestions } from '../repository/questionTransfer.repository.js';

export async function exportQuestionsInternal(query, userId) {
  requireQuestionUser(userId);
  const filters = validateOrThrow(exportQuestionsSchema.safeParse(query));
  const questions = await getExportQuestions(writePool, userId, filters);
  if (!questions.length || (filters.question_ids && questions.length !== filters.question_ids.length)) {
    throw new HttpError(404, { message: 'No questions found, or some requested questions are unavailable with these filters' });
  }
  return exportMoodleXml(questions);
}
