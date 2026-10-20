import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { attemptIdSchema, requireQuizAttemptUser } from '../helpers/quiz-attempts.validation.js';
import { attemptError } from '../helpers/attemptQuestions.js';
import { publicAttemptQuestion } from '../helpers/attemptAnswers.js';
import { getOwnedAttemptWithQuestions } from '../repository/quiz-attempts.repository.js';

export async function getQuizAttemptQuestionsInternal(attemptId, userId) {
  requireQuizAttemptUser(userId);
  const input = validateOrThrow(attemptIdSchema.safeParse({ attemptId }));
  const attempt = await getOwnedAttemptWithQuestions(writePool, input.attemptId, userId);
  if (!attempt) throw attemptError(404, 'ATTEMPT_NOT_FOUND', 'Quiz attempt not found');
  if (!['in_progress', 'timed_out'].includes(attempt.status)) {
    throw attemptError(409, 'ATTEMPT_NOT_IN_PROGRESS', 'The attempt is no longer in progress');
  }
  const expired = attempt.expired || attempt.status === 'timed_out';
  if (expired && attempt.settings_snapshot.allow_attempt_review !== true) {
    throw attemptError(403, 'ATTEMPT_REVIEW_NOT_ALLOWED', 'Review of the expired attempt is not allowed');
  }
  // Expired in_progress attempts use finished-feedback rules without changing
  // their stored status or grades. Automatic finalization remains separate.
  const presentation = { ...attempt, expired };
  return {
    attempt_id: attempt.id, status: attempt.status, expires_at: attempt.expires_at,
    is_expired: expired, questions: attempt.questions.map(question => publicAttemptQuestion(presentation, question)),
  };
}
