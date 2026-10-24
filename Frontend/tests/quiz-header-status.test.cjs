const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { JSDOM } = require('jsdom');
const { QueryClient, QueryClientProvider, useQuery, useQueryClient } = require('@tanstack/react-query');
const messages = require('../app/locales/en.json');

test('editor header uses the status picker, preserves settings drafts and respects publishing checks and permissions', async t => {
  const dom = new JSDOM('<div id="root"></div>');
  const names = ['window', 'document', 'HTMLElement', 'ResizeObserver', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    ResizeObserver: class { observe() {} disconnect() {} }, IS_REACT_ACT_ENVIRONMENT: true });
  window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  const { act } = React, { createRoot } = require('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  t.after(async () => {
    await act(async () => root.unmount()); client.clear(); dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
  });
  const cache = new Map(), requests = [], dirty = [], styles = new Proxy({}, { get: (_, key) => key });
  let quiz, editable = true, problems = [], checks = 0;
  const mocks = {
    '~/i18n': { useI18n: () => ({ t: key => messages[key] ?? key }) },
    '~/constants': { ActiveSVG: '✓', EditSVG: '✎', InactiveSVG: '−', CheckSVG: '✓' },
    '~/hooks/usePopupPresence': { usePopupPresence: open => ({ mounted: open, visible: open }) },
    'react-router': { Link: () => null },
    '~/components/library/ProfileTabs': { default: ({ children }) => children },
    '~/components/library/DurationInput': { default: () => null },
    './QuizParts': {}, './QuizCertificate': { default: () => null },
    './EditorPopup': { EditorActions: ({ children }) => React.createElement('div', { className: 'actions' }, children), EditorBusyStatusContext: React.createContext(false) },
    './inspectQuiz': { inspectQuiz: async () => { checks++; return problems; } },
    './api': { engineKey: ['quiz-engine'], request: async (route, method, body) => { requests.push({ route, method, body }); quiz = { ...quiz, ...body }; return { quiz }; } },
    './shared': {
      styles, useAccess: () => ({ update: editable, create: true, can: () => true }),
      useDetail: () => useQuery({ queryKey: ['quiz-engine', 'quiz'], queryFn: async () => ({ quiz }) }),
      useAction: () => { const queryClient = useQueryClient(); return { busy: false, setError() {}, run: async work => { await work(); await queryClient.invalidateQueries({ queryKey: ['quiz-engine'] }); } }; },
      Notice: () => null, LoadState: () => null,
      Field: ({ children, label }) => React.createElement('label', null, label, children),
      Select: ({ label, value, values, onChange }) => React.createElement('select', { 'aria-label': label, value, onChange: event => onChange(event.target.value) }, values.map(option => React.createElement('option', { key: option.value, value: option.value }, option.label))),
    },
  };
  function load(file) {
    if (!path.extname(file)) file += fs.existsSync(file + '.ts') ? '.ts' : '.tsx';
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    new Function('require', 'module', 'exports', code)(name => name in mocks ? { __esModule: true, ...mocks[name] } : name.endsWith('.css') ? {} : name.startsWith('~/') ? load(path.resolve('app', name.slice(2))) : name.startsWith('.') ? load(path.resolve(path.dirname(file), name)) : require(name), mod, mod.exports);
    return mod.exports;
  }
  quiz = { ...load(path.resolve('app/components/quizEngine/model.ts')).defaultSettings, id: 'quiz', user_id: 'owner', title: 'Saved quiz', status: 'published' };
  const Editor = load(path.resolve('app/components/quizEngine/QuizEditor.tsx')).default;
  const render = () => root.render(React.createElement(QueryClientProvider, { client }, React.createElement(Editor, { id: 'quiz', section: 'settings', onDirty: value => dirty.push(value), onSaved() {}, onClose() {}, onSectionChange() {} })));
  const tick = () => act(() => new Promise(resolve => setTimeout(resolve, 20)));
  const trigger = () => document.querySelector('.libraryHeader .statusPickerTrigger');
  const status = () => document.querySelector('select[aria-label="Status"]');
  const click = async element => { assert.ok(element); await act(async () => element.click()); await tick(); };
  const selectStatus = async label => click([...document.querySelectorAll('.statusPickerPopup label')].find(element => element.textContent.endsWith(label)).querySelector('input'));
  await act(async () => render()); await tick();
  assert.match(trigger().textContent, /Published/);
  const title = document.querySelector('input[aria-label="Title"]');
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(title, 'Unsaved title');
    title.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  await click(trigger()); await selectStatus('Archived'); await click(document.querySelector('.statusPickerSave'));
  assert.deepEqual(requests[0], { route: '/quiz', method: 'PATCH', body: { status: 'archived' } });
  assert.equal(status().value, 'archived');
  assert.equal(title.value, 'Unsaved title');
  assert.equal(dirty.at(-1), true);
  await act(async () => document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))); await tick();
  assert.equal(requests[1].body.status, 'archived', 'saving settings must not revert the header status change');
  assert.equal(requests[1].body.title, 'Unsaved title');
  assert.equal(dirty.at(-1), false);
  problems = ['qeTooFew'];
  await click(trigger()); await selectStatus('Published'); await click(document.querySelector('.statusPickerSave'));
  assert.equal(checks, 1);
  assert.equal(requests.length, 2, 'failed readiness must not publish');
  assert.ok(document.querySelector('.statusPickerPopup [role="alert"]'));
  await click(document.querySelector('.statusPickerActions button'));
  assert.equal(quiz.status, 'archived');
  editable = false; await act(async () => render());
  assert.equal(trigger().disabled, true);
});
