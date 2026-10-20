const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const compiled = ts.transpileModule(fs.readFileSync('app/components/quizEngine/categoryMembership.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
new Function('module', 'exports', compiled)(loaded, loaded.exports);
const { reconcileCategoryMembers, sameCategoryMembers } = loaded.exports;
test('moving a question in its editor updates a clean category selection', () => {
  assert.deepEqual(reconcileCategoryMembers(['a', 'b'], ['a', 'b'], ['b']), ['b']);
});
test('question refresh preserves unsaved category additions and removals', () => {
  assert.deepEqual(reconcileCategoryMembers(['a', 'b', 'c'], ['a', 'c', 'd'], ['b', 'c', 'e']), ['c', 'e', 'd']);
});
test('repeated refreshes do not duplicate members and order alone is not a change', () => {
  assert.deepEqual(reconcileCategoryMembers(['a'], ['a', 'b'], ['a', 'b']), ['a', 'b']);
  assert.equal(sameCategoryMembers(['a', 'b'], ['b', 'a']), true);
  assert.equal(sameCategoryMembers(['a', 'b'], ['a']), false);
});
