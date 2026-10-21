const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const React = require('react');
const notifications = [];
const { JSDOM } = require('jsdom');

test('quiz success and busy notices add no page content; errors remain visible', async t => {
  const css = fs.readFileSync('app/components/quizEngine/engine.module.css', 'utf8').replace(/:global\(([^)]+)\)/g, '$1');
  const dom = new JSDOM(`<style>${css}</style><div id="root"></div><div id="notifications" class="popupNotice"></div>`);
  const names = ['window', 'document', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  const { act } = React, { createRoot } = require('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount()); dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  const context = React.createContext(undefined), host = document.getElementById('notifications');
  const mocks = {
    '@tanstack/react-query': {}, '~/constants': { InfoSVG: 'i' }, '~/authorization/authorization': {}, '~/functions': {}, '~/i18n': { useI18n: () => ({ t: key => key === 'saving' ? 'Saving...' : key }) },
    '~/components/toast/Toast': { showToast: message => notifications.push(message) }, '~/components/customSelect/customSelect': {}, './api': {}, './model': {},
    './EditorPopup': { EditorNoticeContext: context },
    './engine.module.css': { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) },
  };
  const code = ts.transpileModule(fs.readFileSync('app/components/quizEngine/shared.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => name in mocks ? mocks[name] : require(name), mod, mod.exports);
  const { Notice } = mod.exports;
  async function render(message, target) {
    await act(async () => root.render(React.createElement(context.Provider, { value: target },
      React.createElement('div', { id: 'questions' }, React.createElement(Notice, message), React.createElement('article', null, 'Question')))));
  }
  for (const message of [{}, { success: 'Changes saved.' }, { error: 'A long failure message. '.repeat(30) }, {}]) {
    await render(message, host);
    assert.deepEqual([...document.getElementById('questions').children].map(node => node.tagName), ['ARTICLE']);
    assert.equal(window.getComputedStyle(host).height, '36px');
    assert.equal(window.getComputedStyle(host).overflowY, 'auto');
    if (message.error) assert.equal(host.querySelector('[role="alert"]').textContent, message.error);
    else assert.equal(host.children.length, 0);
  }
  for (const message of [{}, { busy: true }, { success: 'Saved' }]) {
    await render(message, undefined);
    assert.deepEqual([...document.getElementById('questions').children].map(node => node.tagName), ['ARTICLE']);
  }
  await render({ error: 'Save failed' }, undefined);
  assert.equal(document.querySelector('[role="alert"]').textContent, 'Save failed');
});
