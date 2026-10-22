import { z } from 'zod';
import { gradePendingAnswers } from './gradePendingAnswers.js';
import { attemptError } from '../helpers/attemptQuestions.js';
import { getAttemptSubmissionSummary } from '../repository/quiz-attempts.repository.js';

const percentage = z.number().finite().min(0).max(100).multipleOf(0.01);
const scoringSettings = z.object({ passing_score_percentage: percentage });
const submissionSettings = scoringSettings.extend({ min_answered_percentage: percentage, min_correct_percentage: percentage });

// Caller owns the transaction and attempt lock. Grade pending answers before totals.
// Expiration ignores submission thresholds and can grade after the deadline.
export async function getAttemptResults(database, attempt, { requireSubmissionRequirements = false } = {}) {
  const settings = (requireSubmissionRequirements ? submissionSettings : scoringSettings).safeParse(attempt.settings_snapshot);
  if (!settings.success) throw attemptError(422, 'INVALID_ATTEMPT_SETTINGS', 'The saved submission settings are invalid');
  await gradePendingAnswers(database, attempt, { allowExpired: !requireSubmissionRequirements });
  const summary = await getAttemptSubmissionSummary(database, attempt.id, {
    min_answered_percentage: 0, min_correct_percentage: 0, ...settings.data,
  });
  if (!summary.total_questions || summary.invalid_grading || !Number.isFinite(Number(summary.max_points))
    || Number(summary.max_points) <= 0 || Number(summary.max_points) > 99999999.99
    || !Number.isFinite(Number(summary.earned_points)) || !Number.isFinite(Number(summary.score_percentage))) {
    throw attemptError(422, 'INVALID_ATTEMPT_RESULTS', 'The saved questions or grades cannot produce a valid result');
  }
  if (requireSubmissionRequirements && !summary.answered_requirement_met) {
    throw attemptError(409, 'MIN_ANSWERED_PERCENTAGE_NOT_MET', 'The minimum answered percentage has not been reached');
  }
  if (requireSubmissionRequirements && !summary.correct_requirement_met) {
    throw attemptError(409, 'MIN_CORRECT_PERCENTAGE_NOT_MET', 'The minimum correct percentage has not been reached');
  }
  return summary;
}
