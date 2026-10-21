import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { attemptIdSchema, requireQuizAttemptUser } from '../helpers/quiz-attempts.validation.js';
import { attemptError } from '../helpers/attemptQuestions.js';
import { lockOwnedAttempt, isAttemptExpired, submitAttempt } from '../repository/quiz-attempts.repository.js';
import { getAttemptResults } from '../services/attemptResults.js';

const expired = () => attemptError(409, 'ATTEMPT_EXPIRED', 'The attempt time limit has expired');

export async function submitQuizAttemptInternal(attemptId, userId) {
  requireQuizAttemptUser(userId);
  const input = validateOrThrow(attemptIdSchema.safeParse({ attemptId }));
  const client = await writePool.connect();
  try {
    await client.query('BEGIN');
    // The answer PUT uses the same lock: grades cannot change between totals and commit.
    const attempt = await lockOwnedAttempt(client, input.attemptId, userId);
    if (!attempt) throw attemptError(404, 'ATTEMPT_NOT_FOUND', 'Quiz attempt not found');
    if (attempt.status !== 'in_progress') throw attemptError(409, 'ATTEMPT_NOT_IN_PROGRESS', 'The attempt is no longer in progress');
    // Check the server clock after waiting for any concurrent answer write.
    if (await isAttemptExpired(client, attempt.id)) throw expired();
    const summary = await getAttemptResults(client, attempt, { requireSubmissionRequirements: true });
    // Guard the deadline again at the update, including time spent computing totals.
    const submitted = await submitAttempt(client, attempt.id, summary);
    if (!submitted) throw expired();
    await client.query('COMMIT');
    return submitted;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (['40P01', '40001'].includes(error.code)) {
      throw attemptError(409, 'ATTEMPT_CONFLICT', 'The attempt changed concurrently; retry the request');
    }
    throw error;
  } finally { client.release(); }
}
