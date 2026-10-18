import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { sourceQuotas, selectAttemptQuestions, snapshotAttemptQuestions, publicAttempt } from '../src/modules/quizzes-engine/quiz-attempts/helpers/attemptQuestions.js';

const stable = n => n - 1;
const candidate = (id, group_ids = [], position = 0) => ({ id, group_ids, position, max_points: 2 });
const source = (group_id, question_count, position = 0) => ({ group_id, question_count, question_percentage: null, position });
const settings = (question_count, shuffle_questions = false) => ({ question_count, shuffle_questions, shuffle_options: false });

test('largest remainder quotas use exact hundredths and deterministic position/group tie breaks', () => {
  const percentage = (group_id, question_percentage, position = 0) => ({ group_id, question_percentage, question_count: null, position });
  assert.deepEqual(sourceQuotas([percentage('b', 50), percentage('a', 50)], 3).map(s => [s.group_id, s.quota]), [['a', 2], ['b', 1]]);
  assert.deepEqual(sourceQuotas([percentage('a', 50, 1), percentage('b', 50)], 3).map(s => s.quota), [2, 1]);
  const thirds = [percentage('a', 33.33), percentage('b', 33.33), percentage('c', 33.34)];
  assert.deepEqual(sourceQuotas(thirds, 2).map(s => s.quota), [1, 0, 1]);
  assert.deepEqual(sourceQuotas(thirds, 100).map(s => s.quota), [33, 33, 34]);
  for (const invalid of [[percentage('a', 99.99)], [source('a', 1)], [percentage('a', 50), source('b', 1)],
    [percentage('a', 0), percentage('b', 100)], [percentage('a', 'NaN')], [source('a', 0)],
    [percentage('a', 50), percentage('a', 50)]]) {
    assert.throws(() => sourceQuotas(invalid, 2), { status: 422 });
  }
});

test('overlapping quotas use augmenting paths rather than greedy selection', () => {
  const pool = [candidate('a', ['wide', 'narrow']), candidate('b', ['wide']), candidate('c', [])];
  const selected = selectAttemptQuestions(pool, [source('wide', 1, 0), source('narrow', 1, 1)], settings(2), stable);
  assert.deepEqual(selected.map(q => [q.id, q.source_group_id]), [['a', 'narrow'], ['b', 'wide']]);
  assert.throws(() => selectAttemptQuestions([candidate('a', ['x', 'y']), candidate('b')],
    [source('x', 1), source('y', 1)], settings(2), stable), { status: 422 });
});

test('quota matcher agrees with brute-force feasibility for every 3-by-3 membership graph', () => {
  const groups = ['g0', 'g1', 'g2'];
  for (let mask = 0; mask < 512; mask++) {
    const pool = [0, 1, 2].map(q => candidate(`q${q}`, groups.filter((_, g) => mask & (1 << (q * 3 + g)))));
    const possible = pool.some(a => pool.some(b => pool.some(c => a !== b && a !== c && b !== c
      && a.group_ids.includes('g0') && b.group_ids.includes('g1') && c.group_ids.includes('g2'))));
    if (!possible) {
      assert.throws(() => selectAttemptQuestions(pool, groups.map(g => source(g, 1)), settings(3), stable), { status: 422 });
    } else {
      const chosen = selectAttemptQuestions(pool, groups.map(g => source(g, 1)), settings(3), stable);
      assert.equal(new Set(chosen.map(q => q.id)).size, 3);
      assert.equal(new Set(chosen.map(q => q.source_group_id)).size, 3);
      assert.ok(chosen.every(q => q.group_ids.includes(q.source_group_id)));
    }
  }
});

test('selection is random independently of display ordering and never mutates the candidate pool', () => {
  const pool = [candidate('b', [], 0), candidate('a', [], 0), candidate('c', [], 1)];
  assert.deepEqual(selectAttemptQuestions(pool, [], settings(2), stable).map(q => q.id), ['a', 'b']);
  assert.deepEqual(selectAttemptQuestions(pool, [], settings(2), () => 0).map(q => q.id), ['a', 'c']);
  assert.deepEqual(pool.map(q => q.id), ['b', 'a', 'c']);
  assert.throws(() => selectAttemptQuestions(pool, [], settings(4), stable), { status: 422 });
});

test('snapshots preserve stable answer IDs and shuffle positions; public output strips every answer key and explanation', () => {
  const question = {
    type: 'matching', content: 'Match', explanation: 'secret explanation', options: [],
    matching_options: [{ option_no: 1, content: 'A', position: 1 }, { option_no: 2, content: 'B', position: 2 }],
    matching_items: [{ item_no: 1, content: 'X', correct_option_no: 2, position: 1 }, { item_no: 2, content: 'Y', correct_option_no: 1, position: 2 }],
  };
  const snapshots = snapshotAttemptQuestions([{ ...candidate('a'), source_group_id: null, question_snapshot: question }], { shuffle_options: true }, () => 0);
  assert.equal(snapshots[0].question_snapshot.matching_options[0].option_no, 2);
  assert.equal(snapshots[0].question_snapshot.matching_options[0].position, 1);
  assert.equal(snapshots[0].question_snapshot.matching_items[0].correct_option_no, 1);
  assert.equal(question.matching_options[0].option_no, 1);
  const response = publicAttempt({ settings_snapshot: { scoring_mode: 'partial_credit' } }, snapshots);
  assert.equal(response.settings.scoring_mode, 'partial_credit');
  assert.doesNotMatch(JSON.stringify(response), /correct_option_no|is_correct|explanation|source_group_id|question_snapshot/);
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
