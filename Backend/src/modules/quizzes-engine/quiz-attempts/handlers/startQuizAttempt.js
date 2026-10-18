import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { quizEligibilitySchema, requireQuizAttemptUser } from '../helpers/quiz-attempts.validation.js';
import { areQuizRequirementsMet } from '../../quiz-requirements/repository/quiz-requirements.repository.js';
import {
  lockAttemptCreation, lockQuizForAttempt, getActiveAttempt, getAttemptHistory,
  getAttemptQuestionPool, getAttemptSources, createAttempt, createAttemptQuestions, getAttemptQuestions,
} from '../repository/quiz-attempts.repository.js';
import {
  attemptError, snapshotQuizSettings, validateCandidates, selectAttemptQuestions, snapshotAttemptQuestions, publicAttempt,
} from '../helpers/attemptQuestions.js';

export async function startQuizAttemptInternal(quizId, userId) {
  requireQuizAttemptUser(userId);
  const input = validateOrThrow(quizEligibilitySchema.safeParse({ quizId, userId }));
  const client = await writePool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await lockAttemptCreation(client, input.quizId, input.userId);
    const quiz = await lockQuizForAttempt(client, input.quizId);
    // Published quizzes are accessible to all authenticated participants in the
    // current model; only their creator can see unpublished quizzes.
    if (!quiz || (quiz.status !== 'published' && quiz.user_id !== input.userId)) {
      throw attemptError(404, 'QUIZ_NOT_FOUND', 'Quiz not found');
    }
    const active = await getActiveAttempt(client, input.quizId, input.userId);
    if (active) {
      if (active.expired) {
        // TODO: Finalize the expired attempt as timed_out, including grading,
        // then continue below. Until finalization is implemented, preserve it
        // and block creation instead of bypassing the one-active-attempt index.
        throw attemptError(409, 'ATTEMPT_FINALIZATION_PENDING', 'The expired attempt must be finalized before a new attempt can start');
      }
      const questions = await getAttemptQuestions(client, active.id);
      await client.query('COMMIT');
      return { created: false, attempt: publicAttempt(active, questions) };
    }
    if (quiz.status !== 'published') throw attemptError(409, 'QUIZ_UNAVAILABLE', 'The quiz is not available for a new attempt');
    if (!await areQuizRequirementsMet(client, input.quizId, input.userId)) {
      throw attemptError(403, 'REQUIREMENTS_NOT_MET', 'The quiz video requirements have not been met');
    }
    const history = await getAttemptHistory(client, input.quizId, input.userId);
    if (quiz.max_attempts !== null && history.attempts_used >= quiz.max_attempts) {
      throw attemptError(409, 'MAX_ATTEMPTS_REACHED', 'The maximum number of attempts has been reached');
    }
    if (history.last_attempt_no >= 2147483647) throw attemptError(409, 'ATTEMPT_NUMBER_EXHAUSTED', 'No further attempt numbers are available');

    const settings = snapshotQuizSettings(quiz);
    const sources = await getAttemptSources(client, quiz.id);
    const candidates = await getAttemptQuestionPool(client, quiz.id);
    if ([...sources, ...candidates].some(row => row.user_id !== quiz.user_id)) {
      throw attemptError(422, 'INVALID_QUIZ_CONFIGURATION', 'Quiz questions and source groups must belong to the quiz owner');
    }
    validateCandidates(candidates);
    const selected = selectAttemptQuestions(candidates, sources, settings);
    const questions = snapshotAttemptQuestions(selected, settings);
    const cents = questions.reduce((sum, question) => sum + Math.round(question.max_points * 100), 0);
    if (!Number.isSafeInteger(cents) || cents > 9999999999) {
      throw attemptError(422, 'INVALID_QUIZ_CONFIGURATION', 'The total points exceed the supported score range');
    }
    const attempt = await createAttempt(client, quiz.id, input.userId, history.last_attempt_no + 1, settings, (cents / 100).toFixed(2));
    await createAttemptQuestions(client, attempt.id, questions);
    await client.query('COMMIT');
    return { created: true, attempt: publicAttempt(attempt, questions) };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505' && ['quiz_attempts_one_active', 'quiz_attempts_quiz_user_attempt_no_unique'].includes(error.constraint)) {
      throw attemptError(409, 'ATTEMPT_CONFLICT', 'The attempt state changed; retry the request');
    }
    if (['40P01', '40001'].includes(error.code)) {
      throw attemptError(409, 'ATTEMPT_CONFLICT', 'The quiz was changed concurrently; retry the request');
    }
    throw error;
  } finally { client.release(); }
}
