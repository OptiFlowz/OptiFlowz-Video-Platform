import { writePool } from '../../../../database/index.js';
import { HttpError } from '../../../../common/httpError.js';
import { getOwnedQuiz, lockOwnedGroups } from '../repository/quiz-sources.repository.js';
import { mapQuizSourceError } from './quizSourceErrors.js';

export async function withQuizSourceTransaction(quizId, groupIds, userId, operation) {
  const client = await writePool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    if (!await getOwnedQuiz(client, quizId, userId, true)) throw new HttpError(404, { message: 'Quiz not found' });
    if (!await lockOwnedGroups(client, groupIds, userId)) throw new HttpError(404, { message: 'One or more source groups were not found' });
    const result = await operation(client);
    // Deferred database constraints validate the complete distribution at commit.
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw mapQuizSourceError(error);
  } finally { client.release(); }
}
