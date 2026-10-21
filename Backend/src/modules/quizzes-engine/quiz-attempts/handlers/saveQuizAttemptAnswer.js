import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { attemptAnswerParamsSchema, attemptAnswerBodySchema, requireQuizAttemptUser } from '../helpers/quiz-attempts.validation.js';
import { attemptError } from '../helpers/attemptQuestions.js';
import { validateAttemptQuestion, normalizeAttemptAnswer, gradeAttemptAnswer, publicAttemptAnswer } from '../helpers/attemptAnswers.js';
import { lockOwnedAttempt, isAttemptExpired, getAttemptQuestion, getSavedAttemptAnswer, upsertAttemptAnswer } from '../repository/quiz-attempts.repository.js';

export async function saveQuizAttemptAnswerInternal(params, body, userId) {
  requireQuizAttemptUser(userId);
  const { attemptId, questionNo } = validateOrThrow(attemptAnswerParamsSchema.safeParse(params));
  const input = validateOrThrow(attemptAnswerBodySchema.safeParse(body));
  const client = await writePool.connect();
  try {
    await client.query('BEGIN');
    // Serialize writes (including the first answer) on the attempt row. Future
    // finalization must acquire this same lock before changing status or scores.
    const attempt = await lockOwnedAttempt(client, attemptId, userId);
    if (!attempt) throw attemptError(404, 'ATTEMPT_NOT_FOUND', 'Quiz attempt not found');
    if (attempt.status !== 'in_progress') throw attemptError(409, 'ATTEMPT_NOT_IN_PROGRESS', 'The attempt is no longer in progress');
    // Separate statement after acquiring the lock: a waiter may cross the deadline.
    if (await isAttemptExpired(client, attemptId)) throw expiredAttempt();
    const question = await getAttemptQuestion(client, attemptId, questionNo);
    if (!question) throw attemptError(404, 'ATTEMPT_QUESTION_NOT_FOUND', 'Question not found in this attempt');
    validateAttemptQuestion(question);
    const answer = normalizeAttemptAnswer(question.question_snapshot, input.answer);
    const previous = await getSavedAttemptAnswer(client, attemptId, questionNo);
    let saved;
    if (previous?.checked_at && attempt.settings_snapshot.allow_answer_changes_after_check !== true) {
      const original = normalizeAttemptAnswer(question.question_snapshot, previous.answer);
      if (JSON.stringify(original) !== JSON.stringify(answer)) {
        throw attemptError(409, 'ANSWER_LOCKED', 'The checked answer cannot be changed');
      }
      // A repeated PUT of the same answer is safe and does not change timestamps.
      saved = previous;
    } else {
      const grade = gradeAttemptAnswer(question.question_snapshot, answer, question.max_points, attempt.settings_snapshot.scoring_mode);
      saved = await upsertAttemptAnswer(client, attemptId, questionNo, answer, grade);
      if (!saved) throw expiredAttempt();
    }
    const result = publicAttemptAnswer(attempt, question, saved);
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

function expiredAttempt() {
  // The expiration worker persists timed_out; reject late writes immediately.
  return attemptError(409, 'ATTEMPT_EXPIRED', 'The attempt time limit has expired');
}
