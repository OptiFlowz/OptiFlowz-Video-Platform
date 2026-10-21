const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const React = require('react');
const { JSDOM } = require('jsdom');
const messages = require('../app/locales/en.json');

test('readiness progress and errors stay in the readiness section while saves use the settings heading', async t => {
  const dom = new JSDOM('<div id="root"></div>');
  const names = ['window', 'document', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  window.matchMedia = () => ({ matches: false });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  const { act } = React, { createRoot } = require('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount()); dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  const styles = { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
  const i18n = { useI18n: () => ({ t: key => messages[key] ?? key }) };
  const popup = {
    EditorNoticeContext: React.createContext(undefined), EditorBusyContext: React.createContext(undefined), EditorBusyStatusContext: React.createContext(false),
    EditorActions: ({ children }) => React.createElement('div', { className: 'actions' }, children),
  };
  function load(file, mocks = {}) {
    const code = ts.transpileModule(fs.readFileSync(`app/components/quizEngine/${file}`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    const mod = { exports: {} };
    new Function('require', 'module', 'exports', code)(name => name in mocks ? mocks[name] : require(name), mod, mod.exports);
    return mod.exports;
  }
  const shared = load('shared.tsx', {
    '@tanstack/react-query': { useQueryClient: () => ({ invalidateQueries: async () => {} }) },
    '~/constants': { InfoSVG: 'i' }, '~/authorization/authorization': {}, '~/functions': {}, '~/i18n': i18n, '~/components/customSelect/customSelect': {},
    './api': { engineKey: ['quiz-engine'] }, './model': {}, './EditorPopup': popup, './engine.module.css': styles,
  });
  const model = load('model.ts');
  const quiz = { ...model.defaultSettings, id: 'quiz', user_id: 'owner', title: 'Test', question_count: 1 };
  let resolveCheck, rejectCheck, resolveSave, checks = 0;
  const { default: QuizEditor } = load('QuizEditor.tsx', {
    '~/i18n': i18n, 'react-router': { Link: () => null },
    '~/components/library/ProfileTabs': { __esModule: true, default: ({ children }) => React.createElement('div', null, children) },
    './shared': { ...shared, styles: styles.default, useDetail: () => ({ data: { quiz } }), useAccess: () => ({ update: true, create: true, can: () => true }),
      Select: () => null },
    './api': { request: () => new Promise(resolve => { resolveSave = resolve; }) }, './model': model,
    './inspectQuiz': { inspectQuiz: () => { checks++; return new Promise((resolve, reject) => { resolveCheck = resolve; rejectCheck = reject; }); } },
    './QuizParts': {}, './EditorPopup': popup, './numberDraft': load('numberDraft.ts'),
  });
  await act(async () => root.render(React.createElement(QuizEditor, { id: quiz.id, section: 'settings', onSectionChange() {}, onSaved() {}, onDirty() {}, onClose() {} })));
  const scoring = [...document.querySelectorAll('.settingsSection')].find(el => el.querySelector('h2')?.textContent === messages.qeFeedback);
  for (const key of ['quizPassingScore', 'qeMinAnswered', 'qeMinCorrect']) assert.ok(scoring.querySelector(`input[aria-label="${messages[key]}"]`), `${key} belongs to scoring`);
  assert.equal(document.querySelectorAll('.formHint').length, 0, 'help is no longer permanently below fields');
  const help = document.querySelector('[role="button"][aria-label="Correct answers required to submit (%)"]');
  assert.equal(document.querySelector('[role="tooltip"]'), null);
  await act(async () => help.focus());
  assert.equal(document.querySelector('[role="tooltip"]').textContent, messages.qeHelp_min_correct_percentage);
  assert.equal(document.querySelector('[role="tooltip"]').parentElement, document.body, 'help escapes panel clipping');
  await act(async () => help.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  assert.equal(document.querySelector('[role="tooltip"]'), null);
  const readiness = document.querySelector('.readiness'), check = readiness.querySelector('button');
  const heading = document.querySelector('.settingsSection .partHeader');
  const save = document.querySelector('.actions .saveCaptionsBtn');
  await act(async () => check.click());
  assert.equal(checks, 1);
  assert.equal(check.disabled, true);
  assert.equal(readiness.querySelector('[role="status"]').textContent, 'Checking…');
  assert.ok(readiness.querySelector('.uploadSpinner'));
  assert.equal(heading.querySelector('[role="status"]'), null);
  assert.equal(save.disabled, true);
  await act(async () => resolveCheck([]));
  assert.equal(readiness.querySelector('.success').textContent, messages.qeReady);
  assert.equal(readiness.querySelector('.uploadSpinner'), null);
  assert.equal(check.disabled, false);
  await act(async () => check.click());
  assert.equal(readiness.querySelector('.success'), null, 'old results are cleared before checking again');
  await act(async () => rejectCheck(new Error('Readiness request failed')));
  assert.equal(readiness.querySelector('[role="alert"]').textContent, 'Readiness request failed');
  assert.equal(heading.querySelector('[role="alert"]'), null);
  assert.equal(check.disabled, false);

  const title = document.querySelector('input[aria-label="Title"]');
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(title, 'Changed');
    title.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  await act(async () => save.click());
  assert.equal(heading.querySelector('[role="status"]').textContent, messages.saving);
  assert.ok(heading.querySelector('.uploadSpinner'));
  assert.equal(readiness.querySelector('.uploadSpinner'), null);
  await act(async () => resolveSave({ quiz: { ...quiz, title: 'Changed' } }));
  assert.equal(heading.querySelector('[role="status"]').textContent, messages.qeSaved);
  assert.equal(heading.querySelector('.uploadSpinner'), null);
});
