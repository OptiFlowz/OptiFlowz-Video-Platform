import { getAttemptResults } from './attemptResults.js';
import { isAttemptExpired } from '../repository/quiz-attempts.repository.js';
import { lockAttemptForFinalization, timeOutAttempt } from '../repository/attempt-expiration.repository.js';
import { issueAttemptCertificate } from '../../../certificates/services/issueAttemptCertificate.js';

// Caller owns the transaction. The same attempt row lock is used by answer PUT
// and submit, so status and persisted grades cannot change during finalization.
export async function finalizeExpiredAttempt(database, attemptId) {
  const attempt = await lockAttemptForFinalization(database, attemptId);
  if (!attempt || attempt.status !== 'in_progress' || !await isAttemptExpired(database, attemptId)) return null;
  const summary = await getAttemptResults(database, attempt);
  const finalized = await timeOutAttempt(database, attemptId, summary);
  if (finalized) await issueAttemptCertificate(database, attemptId);
  return finalized;
}
