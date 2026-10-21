const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
function load(file) {
  const mod = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('require', 'module', 'exports', code)(name => load(path.resolve(path.dirname(file), name + '.ts')), mod, mod.exports);
  return mod.exports;
}
const { filterResourcePage, matchesOwnership } = load('app/components/quizEngine/resourceFilter.ts');
test('ownership filters the full ordered result before pagination for quizzes, questions and categories', () => {
  const rows = Array.from({ length: 45 }, (_, i) => ({ id: String(i), user_id: i % 3 ? 'other' : 'me', content: i % 2 ? 'Question' : 'Matching' }));
  const mine = filterResourcePage(rows, 'me', 'mine', '', 2, 10);
  assert.equal(mine.pagination.total, 15);
  assert.equal(mine.pagination.totalPages, 2);
  assert.deepEqual(mine.items.map(row => row.id), ['30', '33', '36', '39', '42']);
  const others = filterResourcePage(rows, 'me', 'others', ' matching ', 1, 20);
  assert.equal(others.pagination.total, 15);
  assert.ok(others.items.every(row => row.user_id !== 'me' && row.content === 'Matching'));
  assert.equal(filterResourcePage(rows, 'me', 'all', '', 1, 20).pagination.total, 45);
  assert.equal(filterResourcePage(rows, undefined, 'others', '', 1, 20).pagination.total, 0);
  assert.equal(matchesOwnership('other', 'me', 'mine'), false);
});
