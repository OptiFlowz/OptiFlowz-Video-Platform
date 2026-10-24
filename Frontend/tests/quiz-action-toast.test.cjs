const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const React = require('react');
const { JSDOM } = require('jsdom');

test('quiz actions show loading throughout the write and refresh, then save or clear on failure and cancellation', async t => {
  const dom = new JSDOM('<div id="root"></div>');
  const names = ['window', 'document', 'HTMLElement', 'Element', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, IS_REACT_ACT_ENVIRONMENT: true });
  window.requestAnimationFrame = () => 1;
  window.cancelAnimationFrame = () => {};
  const { act } = React, { createRoot } = require('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount()); dom.window.close();
    for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  const styles = { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
  function load(file, mocks) {
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    const mod = { exports: {} };
    new Function('require', 'module', 'exports', code)(name => name in mocks ? mocks[name] : name.endsWith('.css') ? styles : require(name), mod, mod.exports);
    return mod.exports;
  }
  const toast = load('app/components/toast/Toast.tsx', { '~/constants': { CheckSVG: '✓' } });
  const messages = require('../app/locales/en.json');
  const client = { invalidateQueries: async () => {} };
  const { useAction, Notice } = load('app/components/quizEngine/shared.tsx', {
    '@tanstack/react-query': { useQueryClient: () => client }, '~/authorization/authorization': {}, '~/constants': {}, '~/functions': {},
    '~/i18n': { useI18n: () => ({ t: key => messages[key] ?? key }) }, '~/components/toast/Toast': toast,
    '~/components/customSelect/customSelect': {}, './api': { engineKey: ['quiz-engine'] }, './model': {},
    './EditorPopup': { EditorBusyContext: React.createContext(undefined), EditorNoticeContext: React.createContext(undefined) },
  });
  let action;
  function Harness() {
    action = useAction();
    return React.createElement(React.Fragment, null, React.createElement(toast.ToastHost), React.createElement('button', { disabled: action.busy }, 'Edit'), React.createElement(Notice, action));
  }
  await act(async () => root.render(React.createElement(Harness)));
  const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
  const exit = async () => act(async () => {
    const event = new window.Event('transitionend', { bubbles: true });
    Object.defineProperty(event, 'propertyName', { value: 'transform' });
    document.querySelector('[data-exiting="true"]').dispatchEvent(event);
  });
  const write = deferred(), refresh = deferred();
  client.invalidateQueries = () => refresh.promise;
  let completion, duplicate = 0;
  await act(async () => { completion = action.run(() => write.promise); });
  assert.equal(action.busy, true);
  assert.equal(document.querySelector('button').disabled, true);
  assert.equal(document.querySelector('[role="status"]').textContent, messages.qeSaving);
  assert.ok(document.querySelector('.uploadSpinner'));
  await act(async () => { void action.run(async () => { duplicate++; }); });
  assert.equal(duplicate, 0, 'pending actions cannot be duplicated');
  await act(async () => write.resolve());
  assert.equal(action.busy, true);
  assert.equal(document.querySelector('[role="status"]').textContent, messages.qeSaving, 'keep loading during the query refresh');
  await act(async () => { refresh.resolve(); await completion; });
  assert.equal(action.busy, false);
  assert.equal(document.querySelector('button').disabled, false);
  assert.equal(document.querySelector('.entering').textContent, `✓${messages.qeSaved}`);
  client.invalidateQueries = async () => {};
  await act(async () => action.run(async () => { throw new Error('Save failed'); }));
  await exit();
  assert.equal(document.querySelector('[role="status"]').textContent, '');
  assert.equal(document.querySelector('[role="alert"]').textContent, 'Save failed');
  assert.equal(action.busy, false);
  await act(async () => action.run(async () => false));
  await exit();
  assert.equal(document.querySelector('[role="status"]').textContent, '', 'cancel does not claim a save');
  await act(async () => action.run(async () => {}, false));
  assert.equal(document.querySelector('[role="status"]').textContent, '', 'silent checks keep their existing local feedback');
  client.invalidateQueries = async () => { throw new Error('Refresh failed'); };
  await act(async () => action.run(async () => {}));
  await exit();
  assert.equal(action.busy, false, 'a failed refresh must release the action lock');
  assert.equal(document.querySelector('[role="status"]').textContent, '');
  assert.equal(document.querySelector('[role="alert"]').textContent, 'Refresh failed');
});
