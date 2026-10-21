import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { answerSettings, answerSnapshot } from './helpers/quiz-answer-fixtures.js';

const attemptId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
let attempt;
mock.module(new URL('../src/database/index.js', import.meta.url).href, { namedExports: { writePool: {} } });
mock.module(new URL('../src/modules/quizzes-engine/quiz-attempts/repository/quiz-attempts.repository.js', import.meta.url).href, {
  namedExports: { getOwnedAttemptWithQuestions: async (_, id, user) => id === attemptId && user === userId ? attempt : null },
});
const { getQuizAttemptQuestionsInternal: getQuestions } = await import('../src/modules/quizzes-engine/quiz-attempts/handlers/getQuizAttemptQuestions.js');
const fixture = (status, allowed = true, visibility = 'after_finish') => ({
  id: attemptId, status, expires_at: null, expired: false, max_points: 3,
  earned_points: 0.25, score_percentage: 8.33, passed: false,
  settings_snapshot: { ...answerSettings, allow_attempt_review: allowed, correctness_visibility: visibility,
    correct_answers_visibility: visibility, explanation_visibility: visibility },
  questions: [{ question_no: 1, question_id: 'q1', max_points: 3, question_snapshot: answerSnapshot(),
    saved_answer: { attempt_id: attemptId, question_no: 1, answer: { option_no: 2 }, checked_at: 'now', is_correct: false, awarded_points: 0.25 } }],
});

test('finished review uses saved answers and grades, never permits edits, and respects each feedback setting', async () => {
  for (const status of ['submitted', 'timed_out']) for (const visibility of ['after_finish', 'after_check', 'never']) {
    attempt = fixture(status, true, visibility);
    const before = structuredClone(attempt);
    const result = await getQuestions(attemptId, userId);
    assert.equal(result.status, status);
    assert.equal(result.result.earned_points, 0.25);
    assert.equal(result.result.score_percentage, 8.33);
    assert.equal(result.questions[0].can_edit, false);
    assert.deepEqual(result.questions[0].answer, { option_no: 2 });
    if (visibility === 'never') assert.deepEqual(result.questions[0].feedback, {});
    else {
      assert.equal(result.questions[0].feedback.awarded_points, 0.25);
      assert.equal(result.questions[0].feedback.is_correct, false);
      assert.ok(result.questions[0].feedback.correct_answers);
    }
    assert.deepEqual(attempt, before);
  }
});

test('review is blocked by the attempt snapshot, including expired attempts, but active attempts remain usable', async () => {
  for (const status of ['submitted', 'timed_out', 'in_progress']) {
    attempt = fixture(status, false);
    if (status === 'in_progress') attempt.expired = true;
    await assert.rejects(getQuestions(attemptId, userId), error => error.status === 403 && error.body.code === 'ATTEMPT_REVIEW_NOT_ALLOWED');
  }
  attempt = fixture('in_progress', false);
  const result = await getQuestions(attemptId, userId);
  assert.equal(Object.hasOwn(result, 'result'), false);
});

test('cancelled and foreign attempts cannot be reviewed; hidden final scores are not reconstructed', async () => {
  attempt = fixture('cancelled');
  await assert.rejects(getQuestions(attemptId, userId), error => error.status === 409);
  attempt = fixture('submitted');
  await assert.rejects(getQuestions(attemptId, attemptId), error => error.status === 404);
  attempt.earned_points = attempt.score_percentage = attempt.passed = null;
  const result = await getQuestions(attemptId, userId);
  assert.equal(result.result.earned_points, null);
  assert.equal(result.result.score_percentage, null);
  assert.equal(result.result.passed, null);
});
