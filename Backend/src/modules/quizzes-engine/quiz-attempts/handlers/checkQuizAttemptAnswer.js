import { validateOrThrow } from '../../../../common/input.validation.js';
import { attemptAnswerParamsSchema, requireQuizAttemptUser } from '../helpers/quiz-attempts.validation.js';
import { attemptError } from '../helpers/attemptQuestions.js';
import { publicAttemptAnswer } from '../helpers/attemptAnswers.js';
import { withActiveAttempt, expiredAttempt } from '../helpers/withActiveAttempt.js';
import { getAttemptQuestion, getSavedAttemptAnswer, recordAttemptAnswerGrade } from '../repository/quiz-attempts.repository.js';
import { gradeSavedAnswer } from '../services/gradePendingAnswers.js';

export async function checkQuizAttemptAnswerInternal(params, userId) {
  requireQuizAttemptUser(userId);
  const { attemptId, questionNo } = validateOrThrow(attemptAnswerParamsSchema.safeParse(params));
  return withActiveAttempt(attemptId, userId, async (client, attempt) => {
    const question = await getAttemptQuestion(client, attemptId, questionNo);
    if (!question) throw attemptError(404, 'ATTEMPT_QUESTION_NOT_FOUND', 'Question not found in this attempt');
    let saved = await getSavedAttemptAnswer(client, attemptId, questionNo);
    if (!saved) throw attemptError(404, 'ANSWER_NOT_FOUND', 'Save an answer before checking it');
    if (saved.checked_at == null) {
      const grade = gradeSavedAnswer(attempt, question, saved.answer);
      if (!grade) throw attemptError(400, 'INCOMPLETE_ANSWER', 'Complete the answer before checking it');
      saved = await recordAttemptAnswerGrade(client, attemptId, questionNo, grade);
      if (!saved) throw expiredAttempt();
    }
    return publicAttemptAnswer(attempt, question, saved);
  });
}
