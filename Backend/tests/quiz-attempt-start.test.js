import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { sourceQuotas, selectAttemptQuestions, snapshotAttemptQuestions, publicAttempt, snapshotQuizSettings } from '../src/modules/quizzes-engine/quiz-attempts/helpers/attemptQuestions.js';

const stable = n => n - 1;
const candidate = (id, category_id = null, position = 0, is_fixed = false) => ({ id, category_id, position, max_points: 2, is_fixed });
const source = (category_id, question_count, position = 0, max_points = 3) => ({ id: category_id ?? 'uncategorized', category_id, question_count, position, max_points });
const settings = (question_count, shuffle_questions = false) => ({ question_count, shuffle_questions, shuffle_options: false });

test('new settings snapshots retain the selected certificate template independently of later quiz edits', () => {
  const id = '12345678-1234-4234-8234-123456789abc';
  for (const templateId of [id, null]) {
    const quiz = { title: 'Quiz', question_count: 1, passing_score_percentage: 50,
      min_answered_percentage: 0, min_correct_percentage: 0, certificate_template_id: templateId, has_certificate: true };
    const snapshot = snapshotQuizSettings(quiz);
    quiz.certificate_template_id = null;
    assert.equal(snapshot.certificate_template_id, templateId);
    assert.equal(Object.hasOwn(snapshot, 'has_certificate'), false);
  }
});

test('every fixed question is included, category selection excludes fixed questions and uses source weights', () => {
  const pool = [candidate('fixed', 'x', 1, true), candidate('random-a', 'x'), candidate('random-b', 'x'), candidate('uncategorized')];
  const selected = selectAttemptQuestions(pool, [source('x', 1, 0, 4.5), source(null, 1, 2)], settings(3), stable);
  assert.deepEqual(selected.map(q => q.id), ['random-a', 'fixed', 'uncategorized']);
  assert.deepEqual(selected.map(q => q.max_points), [4.5, 2, 3]);
  assert.equal(selected[0].source_id, 'x');
  assert.equal(selected[1].source_id, null);
  assert.equal(new Set(selected.map(q => q.id)).size, 3);
  assert.throws(() => selectAttemptQuestions(pool, [source('x', 3)], settings(4)), { status: 422 });
  assert.throws(() => selectAttemptQuestions(pool, [source(null, 2)], settings(3)), { status: 422 });
  assert.throws(() => selectAttemptQuestions(pool, [], settings(4)), { status: 422 });
});

test('random-only, fixed-only and mixed layouts support random selection and stable block positions', () => {
  const pool = [candidate('b', 'x'), candidate('a', 'x'), candidate('c', 'x')];
  assert.deepEqual(selectAttemptQuestions(pool, [source('x', 2)], settings(2), stable).map(q => q.id), ['b', 'a']);
  assert.notDeepEqual(selectAttemptQuestions(pool, [source('x', 2)], settings(2), () => 0).map(q => q.id), ['b', 'a']);
  const fixed = [candidate('b', null, 0, true), candidate('a', null, 0, true), candidate('c', null, 1, true)];
  assert.deepEqual(selectAttemptQuestions(fixed, [], settings(3), stable).map(q => q.id), ['a', 'b', 'c']);
  assert.notDeepEqual(selectAttemptQuestions(fixed, [], settings(3, true), () => 0).map(q => q.id), ['a', 'b', 'c']);
  assert.deepEqual(pool.map(q => q.id), ['b', 'a', 'c']);
  assert.throws(() => selectAttemptQuestions([], [], settings(0)), { status: 422 });
});

test('source counts and points are positive; categories including null are unique', () => {
  for (const invalid of [[source('x', 0)], [source('x', 1.5)], [source('x', 1, -1)], [source('x', 1, 0, 0)], [source(null, 1), source(null, 1)]]) {
    assert.throws(() => sourceQuotas(invalid), { status: 422 });
  }
  assert.equal(sourceQuotas([source('x', 3)])[0].quota, 3);
});

test('snapshots preserve answer IDs and shuffle positions; public output contains no questions', () => {
  const question = {
    type: 'matching', content: 'Match', explanation: 'secret explanation', options: [],
    matching_options: [{ option_no: 1, content: 'A', position: 1 }, { option_no: 2, content: 'B', position: 2 }],
    matching_items: [{ item_no: 1, content: 'X', correct_option_no: 2, position: 1 }, { item_no: 2, content: 'Y', correct_option_no: 1, position: 2 }],
  };
  const snapshots = snapshotAttemptQuestions([{ ...candidate('a'), source_category_id: null, question_snapshot: question }], { shuffle_options: true }, () => 0);
  assert.equal(snapshots[0].question_snapshot.matching_options[0].option_no, 2);
  assert.equal(snapshots[0].question_snapshot.matching_options[0].position, 1);
  assert.equal(snapshots[0].question_snapshot.matching_items[0].correct_option_no, 1);
  assert.equal(question.matching_options[0].option_no, 1);
  const response = publicAttempt({ settings_snapshot: { scoring_mode: 'partial_credit' }, questions: snapshots });
  assert.equal(response.settings.scoring_mode, 'partial_credit');
  assert.equal(Object.hasOwn(response, 'questions'), false);
  assert.doesNotMatch(JSON.stringify(response), /correct_option_no|is_correct|explanation|source_category_id|question_snapshot/);
});

let calls = 0;
mock.module(new URL('../src/database/index.js', import.meta.url).href, { namedExports: { writePool: {
  async connect() { calls++; throw new Error('Unexpected database access'); },
} } });
const { startQuizAttemptInternal: start } = await import('../src/modules/quizzes-engine/quiz-attempts/handlers/startQuizAttempt.js');
test('start rejects unauthenticated and malformed IDs before opening a transaction', async () => {
  const id = '12345678-1234-4234-8234-123456789abc';
  await assert.rejects(start(id), { status: 401 });
  await assert.rejects(start('bad', id), { status: 400 });
  await assert.rejects(start(id, 'bad'), { status: 400 });
  assert.equal(calls, 0);
});


test('null source points inherit individual bank points while explicit points override them', () => {
  const pool = [{ ...candidate('a', 'x'), max_points: '2.75' }, { ...candidate('b', 'x'), max_points: '4.50' }, candidate('fixed', 'x', 1, true)];
  const inherited = selectAttemptQuestions(pool, [source('x', 2, 0, null)], settings(3), stable);
  assert.deepEqual(inherited.map(q => q.max_points), [2.75, 4.5, 2]);
  const overridden = selectAttemptQuestions(pool, [source('x', 2, 0, 5)], settings(3), stable);
  assert.deepEqual(overridden.map(q => q.max_points), [5, 5, 2]);
});
