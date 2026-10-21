const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
function loader(mocks) {
  const cache = new Map();
  function load(file) {
    file = path.resolve(file);
    if (!path.extname(file)) file += fs.existsSync(file + '.ts') ? '.ts' : '.tsx';
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    new Function('require', 'module', 'exports', code)(name => name in mocks ? { __esModule: true, ...mocks[name] } : name.startsWith('.') ? load(path.join(path.dirname(file), name)) : require(name), mod, mod.exports);
    return mod.exports;
  }
  return load;
}
test('Moodle transfer uses multipart authentication and explicit export filters, returning XML as a blob', async () => {
  const calls = [];
  let fail = false;
  const api = loader({ '~/API': { fetchFn: async args => { calls.push(args); return { imported_count: 1, warnings: [] }; }, fetchApiResponse: async (url, options) => {
    calls.push({ url, options }); return fail ? new Response(JSON.stringify({ message: 'Incomplete question' }), { status: 422 }) : new Response('<quiz/>', { headers: { 'Content-Type': 'application/xml' } });
  } }, '~/env': { env: { apiBaseUrl: 'https://api.test' } }, '~/functions': { getToken: () => 'session-token' } })('app/components/quizEngine/transferApi.ts');
  const file = new File(['<quiz/>'], 'bank.xml', { type: 'application/xml' });
  assert.equal(api.validQuestionFile(file), true);
  assert.equal(api.validQuestionFile(new File(['x'], 'backup.mbz')), false);
  assert.equal(api.validQuestionFile(new File([], 'bank.xml')), false);
  assert.equal(api.validQuestionFile({ name: 'bank.xml', size: 5 * 1024 * 1024 + 1 }), false);
  await api.importQuestions(file, 'cat-1');
  assert.equal(calls[0].route, 'api/quizzes/questions/import?category_id=cat-1');
  assert.equal(calls[0].options.body.get('file').name, 'bank.xml');
  assert.equal(calls[0].options.headers['Content-Type'], undefined, 'browser must generate multipart boundary');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer session-token');
  const blob = await api.exportQuestions({ questionIds: ['q1', 'q2'], categoryId: 'cat-1', type: 'matching' });
  assert.equal(await blob.text(), '<quiz/>');
  const query = new URL(calls[1].url).searchParams;
  assert.equal(query.get('question_ids'), 'q1,q2'); assert.equal(query.get('category_id'), 'cat-1'); assert.equal(query.get('type'), 'matching');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer session-token');
  fail = true;
  await assert.rejects(api.exportQuestions({}), /Incomplete question/);
});

async function uiFixture(t, mode, selectedIds = []) {
  const React = require('react'), { act } = React, { JSDOM } = require('jsdom');
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://test.local' });
  const names = ['window', 'document', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'];
  const prior = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = require('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); for (const [name, descriptor] of prior) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  const styles = new Proxy({}, { get: (_, key) => key }), requests = [], invalidations = [], downloads = [];
  let fail = false;
  const en = require('../app/locales/en.json');
  const tFn = (key, params = {}) => String(en[key] ?? key).replace(/\{\{param\.(\w+)\}\}/g, (_, name) => params[name] ?? '');
  const mocks = {
    '~/i18n': { useI18n: () => ({ t: tFn }) }, '@tanstack/react-query': { useQueryClient: () => ({ invalidateQueries: args => invalidations.push(args) }) },
    '~/constants': { UploadSVG: null },
    './api': { engineKey: ['quiz-engine'] },
    './EditorPopup': { default: ({ open, children }) => open ? children : null, EditorActions: ({ children }) => children },
    './shared': { styles, useAccess: () => ({ read: true, user: { id: 'me' } }), useAll: () => ({ data: [{ id: 'mine', name: 'Mine', user_id: 'me' }, { id: 'other', name: 'Other', user_id: 'someone' }] }), LoadState: () => null,
      FieldHelp: () => null, Field: ({ children }) => children, Select: ({ label, values, value, onChange }) => React.createElement('select', { 'aria-label': label, value, onChange: e => onChange(e.target.value) }, values.map(row => React.createElement('option', { key: row.value, value: row.value }, row.label))) },
    './transferApi': { validQuestionFile: file => file.name.endsWith('.xml'), importQuestions: async (file, category) => { requests.push({ file, category }); if (fail) throw new Error('Import failed'); return { imported_count: 2, warnings: [{ question: 1, code: 'TRUEFALSE_AS_SINGLE_CHOICE', message: '<script> is plain warning text' }] }; },
      exportQuestions: async filters => { requests.push(filters); return new Blob(['xml']); }, downloadQuestions: blob => downloads.push(blob) },
  };
  const Component = loader(mocks)('app/components/quizEngine/QuestionTransfer.tsx').default;
  await act(async () => root.render(React.createElement(Component, { mode, selectedIds, onClose() {} })));
  const submit = () => act(async () => document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
  const select = (label, value) => act(async () => { const input = document.querySelector(`select[aria-label="${label}"]`); input.value = value; input.dispatchEvent(new window.Event('change', { bubbles: true })); });
  return { act, requests, invalidations, downloads, submit, select, fail: value => fail = value, file: async name => { const input = document.querySelector('input[type="file"]'); Object.defineProperty(input, 'files', { configurable: true, value: [new dom.window.File(['xml'], name)] }); await act(async () => input.dispatchEvent(new window.Event('change', { bubbles: true }))); } };
}
test('import validates files, keeps failed uploads retryable and displays count and warnings without resubmitting', async t => {
  const ui = await uiFixture(t, 'import');
  assert.ok(!document.querySelector('option[value="other"]'));
  await ui.file('backup.mbz'); await ui.submit(); assert.equal(ui.requests.length, 0);
  await ui.file('bank.xml'); await ui.select('Question category', 'mine');
  ui.fail(true); await ui.submit(); assert.match(document.querySelector('[role="alert"]').textContent, /Import failed/);
  ui.fail(false); await ui.submit();
  assert.equal(ui.requests[1].category, 'mine'); assert.equal(ui.invalidations.length, 1);
  assert.match(document.querySelector('[role="status"]').textContent, /Imported: 2 questions/);
  assert.equal(document.querySelector('script'), null);
  assert.match(document.querySelector('li').textContent, /<script>/);
  assert.equal(document.querySelector('button[type="submit"]'), null);
  await ui.submit(); assert.equal(ui.requests.length, 2);
});
test('export selected questions sends only explicit IDs and downloads the XML', async t => {
  const ui = await uiFixture(t, 'export', ['own-1', 'own-2']);
  await ui.submit(); assert.deepEqual(ui.requests, [{ questionIds: ['own-1', 'own-2'] }]); assert.equal(ui.downloads.length, 1); assert.equal(ui.invalidations.length, 0);
});
test('bank export applies its category and type filters', async t => {
  const ui = await uiFixture(t, 'export');
  await ui.select('Question category', 'mine'); await ui.select('Question Type', 'matching');
  await ui.submit(); assert.deepEqual(ui.requests, [{ categoryId: 'mine', type: 'matching' }]);
});
