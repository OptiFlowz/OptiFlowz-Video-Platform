const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const compiled = ts.transpileModule(fs.readFileSync('app/components/quizEngine/questionFilter.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
new Function('module', 'exports', compiled)(loaded, loaded.exports);
const { filterQuestionPage } = loaded.exports;

test('search finds questions beyond the displayed page and paginates the matches in existing order', () => {
  const questions = Array.from({ length: 130 }, (_, id) => ({ id, content: id >= 100 ? `SQL question ${id}` : `Other question ${id}` }));
  const first = filterQuestionPage(questions, ' sql ', 1, 20);
  assert.equal(first.items[0].id, 100);
  assert.equal(first.items.length, 20);
  assert.deepEqual(first.pagination, { page: 1, limit: 20, total: 30, totalPages: 2, hasNextPage: true, hasPreviousPage: false });
  const second = filterQuestionPage(questions, 'SQL', 2, 20);
  assert.deepEqual(second.items.map(q => q.id), Array.from({ length: 10 }, (_, i) => 120 + i));
  assert.equal(second.pagination.hasNextPage, false);
});

test('search uses literal question text, supports case-insensitive Unicode and handles empty results', () => {
  const questions = [{ content: 'Šta znači 50%?' }, { content: 'What is a_b?' }, { content: 'What is axb?' }, {}];
  assert.equal(filterQuestionPage(questions, 'ŠTA', 1, 20).items.length, 1);
  assert.equal(filterQuestionPage(questions, '%', 1, 20).items.length, 1);
  assert.deepEqual(filterQuestionPage(questions, 'a_b', 1, 20).items, [questions[1]]);
  const empty = filterQuestionPage(questions, 'missing', 1, 20);
  assert.deepEqual(empty.items, []);
  assert.equal(empty.pagination.total, 0);
  assert.equal(empty.pagination.totalPages, 0);
  assert.equal(filterQuestionPage(questions, '', 1, 20).items.length, 4);
});
