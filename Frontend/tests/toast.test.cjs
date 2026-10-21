const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const React = require('react');
const { act } = React;
const { JSDOM } = require('jsdom');
const { createRoot } = require('react-dom/client');

test('shared toast survives page changes, replaces repeated messages and cleans up its timer', async t => {
  const dom = new JSDOM('<div id="root"></div>');
  const previous = new Map(['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const timers = new Map(); let nextId = 0;
  window.setTimeout = callback => { timers.set(++nextId, callback); return nextId; };
  window.clearTimeout = id => timers.delete(id);
  const code = ts.transpileModule(fs.readFileSync('app/components/toast/Toast.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => name === '~/constants' ? { CheckSVG: '✓' } : name.endsWith('.css') ? { __esModule: true, default: { host: 'host', toast: 'toast' } } : require(name), mod, mod.exports);
  const { ToastHost, showToast } = mod.exports, root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, value] of previous) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key]; }
  });
  const render = page => act(async () => root.render(React.createElement(React.Fragment, null, React.createElement(ToastHost), React.createElement('main', null, page))));
  await render('Edit question');
  const host = document.querySelector('[role="status"]');
  assert.equal(host.parentElement, document.body);
  await act(async () => showToast('Changes saved.'));
  assert.equal(host.textContent, '✓Changes saved.');
  await render('Question bank');
  assert.equal(host.textContent, '✓Changes saved.');
  await act(async () => showToast('Changes saved.'));
  assert.equal(timers.size, 1, 'repeated saves replace the timeout instead of stacking toasts');
  assert.equal(document.querySelectorAll('.toast').length, 1);
  await act(async () => { for (const callback of timers.values()) callback(); timers.clear(); });
  assert.equal(host.textContent, '');
  await act(async () => showToast('Saved again'));
  await act(async () => root.unmount());
  assert.equal(timers.size, 0);
  await act(async () => showToast('After unmount'));
  assert.equal(timers.size, 0, 'listener is removed on unmount');
});
