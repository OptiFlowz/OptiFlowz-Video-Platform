import { writePool } from '../../../../database/index.js';
import { HttpError } from '../../../../common/httpError.js';
import { getOwnedQuiz, lockOwnedCategories } from '../repository/quiz-sources.repository.js';
import { mapQuizSourceError } from './quizSourceErrors.js';

export async function withQuizSourceTransaction(quizId, categoryIds, userId, operation) {
  const client = await writePool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    if (!await getOwnedQuiz(client, quizId, userId, true)) throw new HttpError(404, { message: 'Quiz not found' });
    if (!await lockOwnedCategories(client, [...new Set(categoryIds.filter(id => id !== null))], userId)) throw new HttpError(404, { message: 'One or more source categories were not found' });
    const result = await operation(client);
    // Database triggers keep the derived quiz size in sync within this transaction.
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw mapQuizSourceError(error);
  } finally { client.release(); }
}
