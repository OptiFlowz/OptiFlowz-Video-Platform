import { z } from 'zod';
import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { attemptIdSchema, requireQuizAttemptUser } from '../helpers/quiz-attempts.validation.js';
import { attemptError } from '../helpers/attemptQuestions.js';
import { lockOwnedAttempt, isAttemptExpired, getAttemptSubmissionSummary, submitAttempt } from '../repository/quiz-attempts.repository.js';

const percentage = z.number().finite().min(0).max(100).multipleOf(0.01);
const submissionSettingsSchema = z.object({
  min_answered_percentage: percentage, min_correct_percentage: percentage, passing_score_percentage: percentage,
});
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
    const settings = submissionSettingsSchema.safeParse(attempt.settings_snapshot);
    if (!settings.success) throw attemptError(422, 'INVALID_ATTEMPT_SETTINGS', 'The saved submission settings are invalid');
    const summary = await getAttemptSubmissionSummary(client, attempt.id, settings.data);
    if (!summary.total_questions || summary.invalid_grading || Number(summary.max_points) <= 0
      || Number(summary.max_points) > 99999999.99) {
      throw attemptError(422, 'INVALID_ATTEMPT_RESULTS', 'The saved questions or grades cannot produce a valid result');
    }
    if (!summary.answered_requirement_met) {
      throw attemptError(409, 'MIN_ANSWERED_PERCENTAGE_NOT_MET', 'The minimum answered percentage has not been reached');
    }
    if (!summary.correct_requirement_met) {
      throw attemptError(409, 'MIN_CORRECT_PERCENTAGE_NOT_MET', 'The minimum correct percentage has not been reached');
    }
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
