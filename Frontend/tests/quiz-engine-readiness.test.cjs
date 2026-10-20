const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const source = fs.readFileSync('app/components/quizEngine/readiness.ts', 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const loaded = { exports: {} };
new Function('module', 'exports', compiled)(loaded, loaded.exports);
const { allocationValid, sourceQuotas, canFillSources, questionReady, readiness } = loaded.exports;
const q = (id, groups) => ({ id, user_id: 'owner', type: 'single_choice', content: id, groups: groups.map(id => ({ id, name: id })), options: [{ option_no: 1, position: 1, content: 'Yes', is_correct: true }] });
const s = (id, count, percentage = null, position = 0) => ({ group_id: id, question_count: count, question_percentage: percentage, position });
test('overlapping groups require distinct questions and reassign shared candidates', () => {
  const sources = [s('a', 1), s('b', 1)];
  assert.equal(canFillSources(sources, 2, [q('shared', ['a', 'b'])]), false);
  assert.equal(canFillSources(sources, 2, [q('shared', ['a', 'b']), q('only-a', ['a'])]), true);
});
test('percentage allocation uses largest remainders and stable position/group ties', () => {
  const sources = [s('b', null, 50, 1), s('a', null, 50, 0)];
  assert.equal(allocationValid(sources, 3), true);
  assert.deepEqual(sourceQuotas(sources, 3), [1, 2]);
  assert.equal(allocationValid([s('a', null, 33.33), s('b', null, 66.67)], 3), true);
});
test('mixed modes, duplicate groups and incomplete totals cannot be saved', () => {
  assert.equal(allocationValid([s('a', 1), s('b', null, 50)], 2), false);
  assert.equal(allocationValid([s('a', 1), s('a', 1)], 2), false);
  assert.equal(allocationValid([s('a', 1)], 2), false);
  assert.equal(allocationValid([], 2), true);
});
test('matching answers may reuse a target but must reference an existing option', () => {
  const question = { ...q('matching', []), type: 'matching', options: [], matching_options: [{ option_no: 9, content: 'A', position: 1 }], matching_items: [{ item_no: 3, content: 'B', correct_option_no: 9, position: 1 }, { item_no: 7, content: 'C', correct_option_no: 9, position: 2 }] };
  assert.equal(questionReady(question), true);
  question.matching_items[0].correct_option_no = 99;
  assert.equal(questionReady(question), false);
});
test('publication reports incomplete questions and insufficient candidates', () => {
  assert.deepEqual(readiness({ question_count: 2 }, [{ ...q('bad', []), content: '' }], []), ['qeTooFew', 'qeIncomplete']);
});
