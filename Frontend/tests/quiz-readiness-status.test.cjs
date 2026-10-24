const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const React = require('react');
const notifications = [];
const { JSDOM } = require('jsdom');
const messages = require('../app/locales/en.json');

test('readiness progress and errors stay in the readiness section while saves announce through the reusable toast', async t => {
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
    '~/constants': { InfoSVG: 'i' }, '~/authorization/authorization': {}, '~/functions': {}, '~/i18n': i18n, '~/components/toast/Toast': { startToast: () => ({ success: message => notifications.push(message), dismiss() {} }) }, '~/components/customSelect/customSelect': {},
    './api': { engineKey: ['quiz-engine'] }, './model': {}, './EditorPopup': popup, './engine.module.css': styles,
  });
  const model = load('model.ts');
  assert.equal(model.defaultSettings.allow_answer_changes_after_check, true);
  assert.equal(model.defaultSettings.questions_per_page, 1);
  assert.equal(model.settingsOf({ questions_per_page: undefined }).questions_per_page, 1);
  const quiz = { ...model.defaultSettings, id: 'quiz', user_id: 'owner', title: 'Test', question_count: 1, allow_answer_changes_after_check: false };
  let resolveCheck, rejectCheck, resolveSave, checks = 0, savedBody;
  const { default: QuizEditor } = load('QuizEditor.tsx', {
    '~/components/library/DurationInput': load('../library/DurationInput.tsx', { '~/i18n': i18n, './durationInput.module.css': styles }),
    '~/i18n': i18n, 'react-router': { Link: () => null },
    '~/components/library/ProfileTabs': { __esModule: true, default: ({ children }) => React.createElement('div', null, children) },
    './shared': { ...shared, styles: styles.default, useDetail: () => ({ data: { quiz } }), useAccess: () => ({ update: true, create: true, can: () => true }),
      Select: () => null },
    './api': { request: (route, method, body) => new Promise(resolve => { savedBody = body; resolveSave = resolve; }) }, './model': model,
    './inspectQuiz': { inspectQuiz: () => { checks++; return new Promise((resolve, reject) => { resolveCheck = resolve; rejectCheck = reject; }); } },
    './QuizParts': {}, './QuizCertificate': { __esModule: true, default: () => null }, './EditorPopup': popup, './numberDraft': load('numberDraft.ts'),
  });
  await act(async () => root.render(React.createElement(QuizEditor, { id: quiz.id, section: 'settings', onSectionChange() {}, onSaved() {}, onDirty() {}, onClose() {} })));
  assert.deepEqual([...document.querySelectorAll('[role=tab]')].map(tab => tab.textContent), ['Quiz settings', 'Questions', 'Sources', 'Rules', 'Certificate']);
  const scoring = [...document.querySelectorAll('.settingsSection')].find(el => el.querySelector('h2')?.textContent === messages.qeFeedback);
  for (const key of ['quizPassingScore', 'qeMinAnswered', 'qeMinCorrect']) assert.ok(scoring.querySelector(`input[aria-label="${messages[key]}"]`), `${key} belongs to scoring`);
  assert.equal([...document.querySelectorAll('label')].find(el => el.textContent.includes(messages.qeAnswerChanges))?.querySelector('input').checked, false, 'existing settings are preserved');
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

  const pageSize = document.querySelector('input[aria-label="Questions per page"]');
  assert.equal(pageSize.value, '1');
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(pageSize, '3');
    pageSize.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  const durationMinutes = document.querySelector('input[aria-label="Time limit: Minutes"]');
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(durationMinutes, '15');
    durationMinutes.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  const title = document.querySelector('input[aria-label="Title"]');
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(title, 'Changed');
    title.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  await act(async () => save.click());
  assert.equal(heading.querySelector('[role="status"]'), null);
  assert.equal(save.textContent, messages.saving);
  assert.equal(savedBody.time_limit_seconds, 900, 'segmented duration is saved in seconds');
  assert.equal(savedBody.questions_per_page, 3);
  assert.equal(typeof savedBody.questions_per_page, 'number');
  assert.equal(heading.querySelector('.uploadSpinner'), null);
  assert.equal(readiness.querySelector('.uploadSpinner'), null);
  await act(async () => resolveSave({ quiz: { ...quiz, title: 'Changed' } }));
  assert.equal(heading.querySelector('[role="status"]'), null);
  assert.deepEqual(notifications, [messages.qeSaved]);
  assert.equal(heading.querySelector('.uploadSpinner'), null);
});
