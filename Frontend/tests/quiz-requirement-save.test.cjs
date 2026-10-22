const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const compiled = ts.transpileModule(fs.readFileSync('app/components/quizEngine/saveRequirement.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
new Function('module', 'exports', compiled)(loaded, loaded.exports);
const { saveRequirement } = loaded.exports;
const original = { quiz_id: 'quiz', video_id: 'old', position: 4, min_watch_percentage: 50, min_watch_seconds: null };
const threshold = { min_watch_percentage: null, min_watch_seconds: 30 };

function server(fail = () => false) {
  const rules = new Map([['old', original]]);
  const calls = [];
  return { rules, calls, write: async (path, method, body) => {
    calls.push({ path, method, body });
    if (fail(path, method)) throw new Error('Request failed');
    const id = path.split('/').at(-1);
    if (method === 'POST') {
      if (rules.has(body.video_id)) throw new Error('Duplicate video');
      rules.set(body.video_id, body);
    } else if (method === 'PATCH') rules.set(id, { ...rules.get(id), ...body });
    else if (method === 'DELETE') rules.delete(id);
    else if (method === 'GET') return { requirement: rules.get(id) };
  } };
}

test('changing video preserves position and selected thresholds without leaving an extra rule', async () => {
  const api = server();
  await saveRequirement(api.write, original, false, 'new', threshold, 'Incomplete');
  assert.deepEqual([...api.rules.values()], [{ quiz_id: 'quiz', video_id: 'new', position: 4, is_active: true, ...threshold }]);
  assert.deepEqual(api.calls.map(c => c.method), ['POST', 'DELETE']);
});
test('rejected replacement leaves the original untouched', async () => {
  const api = server((_, method) => method === 'POST');
  await assert.rejects(saveRequirement(api.write, original, false, 'new', threshold, 'Incomplete'));
  assert.deepEqual([...api.rules.values()], [original]);
  assert.equal(api.calls.length, 1);
});
test('failure to remove the old rule rolls back the replacement', async () => {
  const api = server((path, method) => method === 'DELETE' && path.endsWith('/old'));
  await assert.rejects(saveRequirement(api.write, original, false, 'new', threshold, 'Incomplete'));
  assert.deepEqual([...api.rules.values()], [original]);
});
test('failed rollback reports an incomplete replacement instead of success', async () => {
  const api = server((_, method) => method === 'DELETE');
  await assert.rejects(saveRequirement(api.write, original, false, 'new', threshold, 'Review both rules'), /Review both rules/);
  assert.equal(api.rules.size, 2);
});
test('same video updates the existing rule; adding a rule never removes another', async () => {
  const api = server();
  await saveRequirement(api.write, original, false, 'old', threshold, 'Incomplete');
  assert.deepEqual(api.calls.map(c => c.method), ['PATCH']);
  assert.equal(api.rules.get('old').position, 4);
  await saveRequirement(api.write, original, true, 'new', threshold, 'Incomplete');
  assert.equal(api.rules.size, 2);
  assert.deepEqual(api.calls.map(c => c.method), ['PATCH', 'POST']);
});

test('lost delete response cannot cause both old and new rules to be removed', async () => {
  const api = server();
  const write = async (path, method, body) => {
    const result = await api.write(path, method, body);
    if (method === 'DELETE' && path.endsWith('/old')) throw new Error('Lost response');
    return result;
  };
  await assert.rejects(saveRequirement(write, original, false, 'new', threshold, 'Review rules'), /Review rules/);
  assert.equal(api.rules.has('new'), true);
  assert.equal(api.rules.has('old'), false);
});
