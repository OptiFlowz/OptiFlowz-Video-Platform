import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerSettings, answerSnapshot } from './helpers/quiz-answer-fixtures.js';
import { normalizeAttemptAnswer, gradeAttemptAnswer, publicAttemptAnswer, validateAttemptQuestion } from '../src/modules/quizzes-engine/quiz-attempts/helpers/attemptAnswers.js';

test('answers use stable snapshot identifiers, validate their type and reject client grading fields', () => {
  const single = answerSnapshot(), multiple = answerSnapshot('multiple_choice'), matching = answerSnapshot('matching');
  for (const snapshot of [single, multiple, matching]) validateAttemptQuestion({ question_snapshot: snapshot, max_points: '1.00' });
  for (const input of [null, {}, [], { option_no: '1' }, { option_no: 0 }, { option_no: 5 }, { option_no: 1, is_correct: true }, { option_nos: [1] }]) {
    assert.throws(() => normalizeAttemptAnswer(single, input), error => error.status === 400);
  }
  for (const input of [{ option_nos: [] }, { option_nos: [1, 1] }, { option_nos: [1, 5] }, { option_no: 1 }]) {
    assert.throws(() => normalizeAttemptAnswer(multiple, input), error => error.status === 400);
  }
  assert.deepEqual(normalizeAttemptAnswer(multiple, { option_nos: [2, 1] }), { option_nos: [1, 2] });
  for (const pairs of [[], [{ item_no: 1, option_no: 1 }],
    [{ item_no: 1, option_no: 1 }, { item_no: 1, option_no: 1 }, { item_no: 3, option_no: 1 }],
    [{ item_no: 1, option_no: 1 }, { item_no: 2, option_no: 3 }, { item_no: 3, option_no: 1 }],
    [{ item_no: 1, option_no: 1 }, { item_no: 2, option_no: 2 }, { item_no: 4, option_no: 1 }]]) {
    assert.throws(() => normalizeAttemptAnswer(matching, { pairs }), error => error.status === 400);
  }
  const pairs = [{ item_no: 3, option_no: 1 }, { item_no: 2, option_no: 2 }, { item_no: 1, option_no: 1 }];
  assert.deepEqual(normalizeAttemptAnswer(matching, { pairs }).pairs.map(pair => pair.item_no), [1, 2, 3]);
  assert.throws(() => validateAttemptQuestion({ question_snapshot: {}, max_points: 1 }), error => error.status === 422);
});

test('exact and partial scoring, penalties, all-correct options, shared matching options and cent rounding', () => {
  const grade = (type, answer, mode, points = 3) => gradeAttemptAnswer(answerSnapshot(type), answer, points, mode);
  for (const mode of ['exact_match', 'partial_credit']) {
    assert.deepEqual(grade('single_choice', { option_no: 1 }, mode), { is_correct: true, awarded_points: 3 });
    assert.deepEqual(grade('single_choice', { option_no: 2 }, mode), { is_correct: false, awarded_points: 0 });
    assert.deepEqual(grade('multiple_choice', { option_nos: [2, 1] }, mode), { is_correct: true, awarded_points: 3 });
    assert.deepEqual(grade('multiple_choice', { option_nos: [1, 2, 3, 4] }, mode), { is_correct: false, awarded_points: 0 });
  }
  assert.deepEqual(grade('multiple_choice', { option_nos: [1] }, 'partial_credit'), { is_correct: false, awarded_points: 1.5 });
  assert.deepEqual(grade('multiple_choice', { option_nos: [1, 2, 3] }, 'partial_credit'), { is_correct: false, awarded_points: 1.5 });
  assert.equal(grade('multiple_choice', { option_nos: [1] }, 'exact_match').awarded_points, 0);
  assert.equal(grade('multiple_choice', { option_nos: [3, 4] }, 'partial_credit').awarded_points, 0);
  const allCorrect = answerSnapshot('multiple_choice');
  allCorrect.options.forEach(option => { option.is_correct = true; });
  assert.equal(gradeAttemptAnswer(allCorrect, { option_nos: [1, 2] }, '5.00', 'partial_credit').awarded_points, 2.5);
  const pairs = [{ item_no: 1, option_no: 1 }, { item_no: 2, option_no: 2 }, { item_no: 3, option_no: 2 }];
  assert.deepEqual(grade('matching', { pairs }, 'partial_credit', 1), { is_correct: false, awarded_points: 0.67 });
  assert.equal(grade('matching', { pairs }, 'exact_match').awarded_points, 0);
  pairs[2].option_no = 1;
  assert.deepEqual(grade('matching', { pairs }, 'exact_match', '99999999.99'), { is_correct: true, awarded_points: 99999999.99 });
  assert.equal(grade('multiple_choice', { option_nos: [1] }, 'partial_credit', '0.01').awarded_points, 0.01);
  assert.throws(() => grade('single_choice', { option_no: 1 }, 'invalid'), error => error.status === 422);
});

test('feedback visibility settings are independent, checked-only and reusable for allowed finished review', () => {
  const visibilities = ['never', 'after_check', 'after_finish'];
  for (const status of ['in_progress', 'submitted', 'timed_out', 'cancelled'])
    for (const allow_attempt_review of [false, true])
      for (const checked of [false, true])
        for (const is_correct of [false, true])
          for (const explanation_incorrect_only of [false, true])
            for (const correctness_visibility of visibilities)
              for (const correct_answers_visibility of visibilities)
                for (const explanation_visibility of visibilities) {
                  const settings = { ...answerSettings, allow_attempt_review, explanation_incorrect_only,
                    correctness_visibility, correct_answers_visibility, explanation_visibility };
                  const saved = { attempt_id: 'attempt', question_no: 1, answer: { option_no: 2 },
                    checked_at: checked ? 'checked' : null, updated_at: 'updated', is_correct, awarded_points: 1, private_field: 'hidden' };
                  const result = publicAttemptAnswer({ status, settings_snapshot: settings }, { question_snapshot: answerSnapshot() }, saved);
                  const visible = value => checked && (status === 'in_progress' ? value === 'after_check'
                    : ['submitted', 'timed_out'].includes(status) && allow_attempt_review && value !== 'never');
                  assert.equal(Object.hasOwn(result.feedback, 'is_correct'), visible(correctness_visibility));
                  assert.equal(Object.hasOwn(result.feedback, 'awarded_points'), visible(correctness_visibility));
                  assert.equal(Object.hasOwn(result.feedback, 'correct_answers'), visible(correct_answers_visibility));
                  assert.equal(Object.hasOwn(result.feedback, 'explanation'), visible(explanation_visibility) && (!explanation_incorrect_only || !is_correct));
                  assert.deepEqual(Object.keys(result), ['attempt_id', 'question_no', 'answer', 'checked_at', 'updated_at', 'feedback', 'can_edit']);
                }
  const result = publicAttemptAnswer({ status: 'in_progress', settings_snapshot: { correct_answers_visibility: 'after_check' } },
    { question_snapshot: answerSnapshot('matching') }, { checked_at: 'checked' });
  assert.deepEqual(result.feedback, { correct_answers: { matching_items: [
    { item_no: 1, correct_option_no: 1 }, { item_no: 2, correct_option_no: 2 }, { item_no: 3, correct_option_no: 1 },
  ] } });
});

test('expired in-progress attempts use the same review feedback rules as timed_out without mutating their state', () => {
  const question = { question_snapshot: answerSnapshot() };
  for (const visibility of ['never', 'after_check', 'after_finish'])
    for (const allow_attempt_review of [false, true])
      for (const checked_at of [null, 'checked']) {
        const settings_snapshot = { ...answerSettings, allow_attempt_review, correctness_visibility: visibility,
          correct_answers_visibility: visibility, explanation_visibility: visibility };
        const saved = { answer: { option_no: 1 }, checked_at, is_correct: true, awarded_points: 3 };
        const expired = { status: 'in_progress', expired: true, settings_snapshot };
        assert.deepEqual(publicAttemptAnswer(expired, question, saved),
          publicAttemptAnswer({ status: 'timed_out', settings_snapshot }, question, saved));
        assert.equal(expired.status, 'in_progress');
      }
});


test('draft answers allow empty selections and partial matching while validating snapshot identifiers', () => {
  const draft = { allowIncomplete: true };
  for (const [type, answer] of [
    ['single_choice', { option_no: null }], ['multiple_choice', { option_nos: [] }],
    ['matching', { pairs: [] }], ['matching', { pairs: [{ item_no: 2, option_no: 1 }] }],
  ]) {
    assert.deepEqual(normalizeAttemptAnswer(answerSnapshot(type), answer, draft), answer);
    assert.throws(() => normalizeAttemptAnswer(answerSnapshot(type), answer), error => error.body.code === 'INCOMPLETE_ANSWER');
  }
  for (const pairs of [[{ item_no: 8, option_no: 1 }], [{ item_no: 1, option_no: 9 }],
    [{ item_no: 1, option_no: 1 }, { item_no: 1, option_no: 2 }]]) {
    assert.throws(() => normalizeAttemptAnswer(answerSnapshot('matching'), { pairs }, draft), { status: 400 });
  }
});
