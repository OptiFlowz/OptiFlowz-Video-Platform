const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { JSDOM } = require('jsdom');

function modules(mocks) {
  const cache = new Map();
  function load(file) {
    file = path.resolve(file);
    if (!path.extname(file)) file += fs.existsSync(`${file}.ts`) ? '.ts' : '.tsx';
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function('require', 'module', 'exports', code)(name => {
      if (name in mocks) return mocks[name];
      if (name.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
      if (/\.(webp|png)$/.test(name)) return '/thumbnail.webp';
      if (name.startsWith('~/')) return load(path.join(__dirname, '../app', name.slice(2)));
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name));
      return require(name);
    }, mod, mod.exports);
    return mod.exports;
  }
  return relative => load(path.join(__dirname, '../app/components/collections', relative));
}

test('collection header confirms deletion, enforces ownership, handles failures and returns to collections', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://test.local/edit-collection?collection=c' });
  const previous = new Map(['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const { act } = React, { createRoot } = require('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  let allowed = true, confirmed = false, response = { deleted: true }, release;
  const calls = [], prompts = [], invalidations = [], navigations = [];
  const load = modules({
    '~/functions': { getToken: () => 'token' }, '~/constants': { DeleteSVG: null },
    '~/i18n': { useI18n: () => ({ t: (key, params) => params?.title ? `${key}: ${params.title}` : key }) },
    '~/authorization/authorization': { useAuthorization: () => ({ canOwn: (own, any, owner) => { assert.equal(owner, 'owner'); assert.match(own, /collections/); assert.match(any, /collections/); return allowed; }, canAny: () => { throw new Error('Use ownership for collections'); } }) },
    'react-router': { useNavigate: () => (...args) => navigations.push(args) },
    '@tanstack/react-query': { useQueryClient: () => ({ invalidateQueries: value => { invalidations.push(value); return Promise.resolve(); } }) },
    '~/components/confirmPopup/useConfirm': { useConfirm: () => ({ confirm: async options => { prompts.push(options); return confirmed; }, dialogProps: { open: false } }) },
    '~/components/confirmPopup/confirmDialog': { ConfirmDialog: () => null },
    '~/API': { fetchFn: async input => { calls.push(input); await new Promise(resolve => { release = resolve; }); return response; } },
  });
  const { EditorHeader } = load('../shared/editorHeader.tsx');
  const render = disabled => root.render(React.createElement(EditorHeader, { kind: 'collection', id: 'c', resourceTitle: 'My collection', ownerId: 'owner', heading: 'Edit collection', disabled }, 'Edit details, cover and playlist order.'));
  await act(async () => render(false));
  assert.match(document.body.textContent, /collectionDelete/);
  await act(async () => document.querySelector('button').click());
  assert.equal(calls.length, 0);
  assert.deepEqual(prompts[0], { title: 'collectionDeleteTitle: My collection', message: 'collectionDeleteHelp', yesText: 'adminDelete', noText: 'adminCancel' });
  confirmed = true; response = { deleted: false };
  await act(async () => { document.querySelector('button').click(); document.querySelector('button').click(); });
  assert.equal(calls.length, 1); assert.equal(document.querySelector('button').disabled, true);
  await act(async () => release());
  assert.match(document.querySelector('[role="alert"]').textContent, /somethingWentWrong/);
  assert.equal(navigations.length, 0);
  response = { deleted: true };
  await act(async () => document.querySelector('button').click());
  await act(async () => release());
  assert.equal(calls[1].route, 'api/collections/c'); assert.equal(calls[1].options.method, 'DELETE');
  assert.deepEqual(invalidations, [{ queryKey: ['collections'] }]);
  assert.deepEqual(navigations, [['/my-collections', { replace: true }]]);
  await act(async () => render(true)); assert.equal(document.querySelector('button').disabled, true);
  allowed = false; await act(async () => render(false)); assert.equal(document.querySelector('button'), null);
});

test('every supported catalogue includes the new collection, quiz and video-picker messages with intact parameters', () => {
  const locales = path.join(__dirname, '../app/locales');
  const english = JSON.parse(fs.readFileSync(path.join(locales, 'en.json'), 'utf8'));
  const keys = Object.keys(english).filter(key => /^(collection|navMyCollections|permission\.collections\.|quizIntro|quizHistory|quizPassed|quizNotPassed|quizStartQuiz|quizBefore|quizResumeHint|quizStartHint|quizTimeLimitLabel|quizPassingScoreLabel|quizAttemptsLabel|quizUnlimitedLabel|quizCertificateHint|quizQuestionPosition|quizAnsweredLabel|quizSelectOneHint|quizSelectMultipleHint|quizMatchHint|quizScoreLabel|playlistAddVideos|playlistVideoSource|playlistPublicVideos|playlistVideoAdded|playlistVideoPickerHelp)/.test(key));
  for (const file of fs.readdirSync(locales).filter(file => file.endsWith('.json'))) {
    const catalogue = JSON.parse(fs.readFileSync(path.join(locales, file), 'utf8'));
    for (const key of keys) {
      const variants = value => typeof value === 'string' ? [value] : Object.entries(value).filter(([name]) => !['select', 'rule'].includes(name)).map(([, text]) => text);
      assert.ok(catalogue[key], `${file}: ${key} is missing`);
      for (const text of variants(catalogue[key])) assert.ok(text.trim(), `${file}: ${key} is empty`);
      const placeholders = value => [...new Set(variants(value).flatMap(text => [...text.matchAll(/\{\{[^{}]+\}\}/g)].map(match => match[0])))].sort();
      assert.deepEqual(placeholders(catalogue[key]), placeholders(english[key]), `${file}: ${key}`);
    }
  }
});
