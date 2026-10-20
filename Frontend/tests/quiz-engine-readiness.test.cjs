const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function load(file) {
  const compiled = ts.transpileModule(fs.readFileSync(`app/components/quizEngine/${file}.ts`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  new Function('module', 'exports', compiled)(loaded, loaded.exports);
  return loaded.exports;
}
const { allocationValid, canFillSources, questionReady, readiness, questionCount, nextPosition } = load('readiness');
const { defaultSettings, settingsOf } = load('model');
const q = (id, category = null) => ({ id, user_id: 'owner', type: 'single_choice', content: id, category: category === null ? null : { id: category, name: category }, options: [{ option_no: 1, position: 1, content: 'Yes', is_correct: true }] });
const s = (id, count, points = 1, position = 0) => ({ category_id: id, question_count: count, max_points: points, position });
test('quiz settings requests never include the derived question count', () => {
  assert.equal(Object.hasOwn(defaultSettings, 'question_count'), false);
  const editable = settingsOf({ ...defaultSettings, title: 'Quiz', question_count: 10 });
  assert.equal(Object.hasOwn(editable, 'question_count'), false);
  assert.equal(editable.title, 'Quiz');
});
test('fixed questions and random quantities add to the derived count', () => {
  const fixed = Array.from({ length: 5 }, (_, i) => ({ question_id: String(i) }));
  assert.equal(questionCount(fixed, [s('a', 3, 2), s(null, 2)]), 10);
  assert.equal(questionCount([], []), 0);
  assert.equal(allocationValid([s('a', 3, 2), s(null, 2)]), true);
});
test('sources draw from the whole bank, excluding all fixed questions', () => {
  const fixed = [q('fixed', 'a')], bank = [...fixed, q('random', 'a'), q('different', 'b')];
  assert.equal(canFillSources([s('a', 1)], fixed, bank), true);
  assert.equal(canFillSources([s('a', 2)], fixed, bank), false);
  assert.deepEqual(readiness([], [s('a', 1)], bank), []);
});
test('uncategorized sources use only uncategorized questions, with unique categories and question IDs', () => {
  assert.equal(canFillSources([s(null, 1)], [], [q('a', 'a')]), false);
  assert.equal(canFillSources([s(null, 1)], [], [q('unassigned')]), true);
  assert.equal(canFillSources([s(null, 2)], [], [q('duplicate'), q('duplicate')]), false);
  assert.equal(allocationValid([s(null, 1), s(null, 1)]), false);
  assert.equal(allocationValid([s('', 2)]), false);
});
test('source counts, points and positions obey the new contract', () => {
  for (const invalid of [s('a', 0), s('a', 1.5), s('a', 1, 0), s('a', 1, 0.001), s('a', 1, Infinity), s('a', 1, 1, -1)]) {
    assert.equal(allocationValid([invalid]), false);
  }
  assert.equal(allocationValid([s('a', 1, 0.01)]), true);
  assert.equal(allocationValid([]), true);
});
test('new items append after both fixed questions and source blocks', () => {
  assert.equal(nextPosition([{ position: 0 }, { position: 1 }], [{ position: 5 }]), 6);
  assert.equal(nextPosition([{ position: 9 }], [{ position: 2 }]), 10);
  assert.equal(nextPosition([], []), 0);
});
test('matching answers may reuse a target but must reference an existing option', () => {
  const question = { ...q('matching'), type: 'matching', options: [], matching_options: [{ option_no: 9, content: 'A', position: 1 }], matching_items: [{ item_no: 3, content: 'B', correct_option_no: 9, position: 1 }, { item_no: 7, content: 'C', correct_option_no: 9, position: 2 }] };
  assert.equal(questionReady(question), true);
  question.matching_items[0].correct_option_no = 99;
  assert.equal(questionReady(question), false);
});
test('readiness checks empty quizzes, fixed questions and all selectable source questions', () => {
  assert.deepEqual(readiness([], []), ['qeTooFew']);
  assert.deepEqual(readiness([{ ...q('bad'), content: '' }], []), ['qeIncomplete']);
  assert.deepEqual(readiness([q('good')], []), []);
  assert.deepEqual(readiness([q('fixed', 'a')], [s('a', 1)], [q('fixed', 'a')]), ['qeOverlap']);
  assert.deepEqual(readiness([], [s('a', 1)], [{ ...q('bad', 'a'), options: [] }]), ['qeIncomplete']);
  assert.deepEqual(readiness([q('good')], [], [{ ...q('unrelated', 'a'), options: [] }]), []);
});
