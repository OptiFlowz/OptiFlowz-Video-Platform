import { validateOrThrow } from '../../../../common/input.validation.js';
import { attemptAnswerParamsSchema, attemptAnswerBodySchema, requireQuizAttemptUser } from '../helpers/quiz-attempts.validation.js';
import { attemptError } from '../helpers/attemptQuestions.js';
import { validateAttemptQuestion, normalizeAttemptAnswer, publicAttemptAnswer } from '../helpers/attemptAnswers.js';
import { withActiveAttempt, expiredAttempt } from '../helpers/withActiveAttempt.js';
import { getAttemptQuestion, getSavedAttemptAnswer, upsertAttemptAnswer } from '../repository/quiz-attempts.repository.js';

export async function saveQuizAttemptAnswerInternal(params, body, userId) {
  requireQuizAttemptUser(userId);
  const { attemptId, questionNo } = validateOrThrow(attemptAnswerParamsSchema.safeParse(params));
  const input = validateOrThrow(attemptAnswerBodySchema.safeParse(body));
  return withActiveAttempt(attemptId, userId, async (client, attempt) => {
    const question = await getAttemptQuestion(client, attemptId, questionNo);
    if (!question) throw attemptError(404, 'ATTEMPT_QUESTION_NOT_FOUND', 'Question not found in this attempt');
    validateAttemptQuestion(question);
    const answer = normalizeAttemptAnswer(question.question_snapshot, input.answer, { allowIncomplete: true });
    const previous = await getSavedAttemptAnswer(client, attemptId, questionNo);
    if (previous) {
      const original = normalizeAttemptAnswer(question.question_snapshot, previous.answer, { allowIncomplete: true });
      // Identical retries retain grades and timestamps, even when edits are enabled.
      if (JSON.stringify(original) === JSON.stringify(answer)) return publicAttemptAnswer(attempt, question, previous);
      if (previous.checked_at && attempt.settings_snapshot.allow_answer_changes_after_check !== true) {
        throw attemptError(409, 'ANSWER_LOCKED', 'The checked answer cannot be changed');
      }
    }
    // Saving a changed answer invalidates the previous grade; only check/finalization grades it.
    const saved = await upsertAttemptAnswer(client, attemptId, questionNo, answer);
    if (!saved) throw expiredAttempt();
    return publicAttemptAnswer(attempt, question, saved);
  });
}
