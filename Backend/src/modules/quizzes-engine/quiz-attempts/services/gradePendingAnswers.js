import { validateAttemptQuestion, normalizeAttemptAnswer, isAttemptAnswerComplete, gradeAttemptAnswer } from '../helpers/attemptAnswers.js';
import { attemptError } from '../helpers/attemptQuestions.js';
import { getUncheckedAttemptAnswers, recordAttemptAnswerGrade } from '../repository/quiz-attempts.repository.js';

export function gradeSavedAnswer(attempt, question, savedAnswer) {
  validateAttemptQuestion(question);
  let answer;
  try {
    answer = normalizeAttemptAnswer(question.question_snapshot, savedAnswer, { allowIncomplete: true });
  } catch (error) {
    if (error.status !== 400) throw error;
    // Stored data corruption is a finalization error, not a new client input error.
    // The expiration worker isolates 422 errors and continues with healthy attempts.
    throw attemptError(422, 'INVALID_ATTEMPT_ANSWER', 'The saved answer is invalid for this question');
  }
  if (!isAttemptAnswerComplete(question.question_snapshot, answer)) return null;
  return gradeAttemptAnswer(question.question_snapshot, answer, question.max_points, attempt.settings_snapshot.scoring_mode);
}

// Submit and expiration call this inside their transaction with the attempt locked.
// Previously checked answers are never regraded. Incomplete drafts remain unchecked.
export async function gradePendingAnswers(database, attempt, { allowExpired = false } = {}) {
  for (const question of await getUncheckedAttemptAnswers(database, attempt.id)) {
    const grade = gradeSavedAnswer(attempt, question, question.answer);
    if (grade && !await recordAttemptAnswerGrade(database, attempt.id, question.question_no, grade, { allowExpired })) {
      throw attemptError(409, 'ATTEMPT_EXPIRED', 'The attempt time limit has expired');
    }
  }
}
