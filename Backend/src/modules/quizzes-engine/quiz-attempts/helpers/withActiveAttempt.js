import { writePool } from '../../../../database/index.js';
import { attemptError } from './attemptQuestions.js';
import { lockOwnedAttempt, isAttemptExpired } from '../repository/quiz-attempts.repository.js';

export async function withActiveAttempt(attemptId, userId, callback) {
  const client = await writePool.connect();
  try {
    await client.query('BEGIN');
    const attempt = await lockOwnedAttempt(client, attemptId, userId);
    if (!attempt) throw attemptError(404, 'ATTEMPT_NOT_FOUND', 'Quiz attempt not found');
    if (attempt.status !== 'in_progress') throw attemptError(409, 'ATTEMPT_NOT_IN_PROGRESS', 'The attempt is no longer in progress');
    // Check after waiting for writers, submit, or the expiration worker.
    if (await isAttemptExpired(client, attemptId)) throw expiredAttempt();
    const result = await callback(client, attempt);
    // Also guard no-op retries and time spent validating/grading.
    if (await isAttemptExpired(client, attemptId)) throw expiredAttempt();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (['40P01', '40001'].includes(error.code)) {
      throw attemptError(409, 'ATTEMPT_CONFLICT', 'The attempt changed concurrently; retry the request');
    }
    throw error;
  } finally { client.release(); }
}

export function expiredAttempt() {
  return attemptError(409, 'ATTEMPT_EXPIRED', 'The attempt time limit has expired');
}
