const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const React = require('react');
const notifications = [];
const { createPortal } = require('react-dom');
const { JSDOM } = require('jsdom');

test('quiz popup waits for its portal before entering and finishes exiting before removal', async t => {
  const dom = new JSDOM('<div id="root"></div><button id="trigger">Open</button>');
  const names = ['window', 'document', 'HTMLElement', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const frames = new Map(), timers = new Map();
  let nextId = 0, portalReady = false, closed = 0;
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    requestAnimationFrame: callback => { const id = ++nextId; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id), IS_REACT_ACT_ENVIRONMENT: true,
  });
  window.scrollTo = () => {};
  window.setTimeout = callback => { const id = ++nextId; timers.set(id, callback); return id; };
  window.clearTimeout = id => timers.delete(id);
  const { act } = React, { createRoot } = require('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount()); dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  function load(file, mocks = {}) {
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    const mod = { exports: {} };
    new Function('require', 'module', 'exports', code)(name => name in mocks ? mocks[name] : require(name), mod, mod.exports);
    return mod.exports;
  }
  const popupModule = load('app/components/quizEngine/EditorPopup.tsx', {
    '~/components/popupPortal/popupPortal': { __esModule: true, default: ({ children }) => portalReady ? createPortal(children, document.body) : null },
    '~/constants': { CloseSVG: '×' }, '~/i18n': { useI18n: () => ({ t: key => key }) },
    './engine.module.css': { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) },
    './scrollLock': load('app/components/quizEngine/scrollLock.ts'),
  });
  const { default: EditorPopup, EditorActions } = popupModule;
  const { Notice } = load('app/components/quizEngine/shared.tsx', {
    '@tanstack/react-query': {}, '~/constants': { InfoSVG: 'i' }, '~/authorization/authorization': {}, '~/functions': {},
    '~/i18n': { useI18n: () => ({ t: key => key === 'saving' ? 'Saving...' : key }) },
    '~/components/toast/Toast': { showToast: message => notifications.push(message) }, '~/components/customSelect/customSelect': {}, './api': {}, './model': {},
    './EditorPopup': popupModule,
    './engine.module.css': { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) },
  });
  const trigger = document.getElementById('trigger');
  trigger.focus();
  const render = async (open, busy = false) => act(async () => root.render(React.createElement(EditorPopup, {
    open, title: open ? 'Add Source' : 'Changed title', onClose() {}, onAfterClose: () => closed++,
  }, React.createElement(Notice, { busy, success: 'Changes saved.' }),
  React.createElement(EditorActions, null, React.createElement('button', { type: 'button' }, 'Back')))));
  async function frame() {
    const pending = [...frames.values()]; frames.clear();
    await act(async () => pending.forEach(callback => callback()));
  }
  await render(true);
  assert.equal(frames.size, 0, 'do not start the entrance before the portal mounts');
  portalReady = true;
  await render(true);
  const panel = document.querySelector('[role="dialog"]');
  assert.ok(panel);
  assert.equal(panel.classList.contains('isOpen'), false);
  await frame();
  assert.equal(panel.classList.contains('isOpen'), false);
  await frame();
  assert.equal(panel.classList.contains('isOpen'), true);
  assert.equal(document.activeElement, panel);

  const feedback = panel.querySelector('.popupNotice'), actions = feedback.parentElement;
  assert.ok(actions.classList.contains('quizPopupActions'));
  assert.equal(feedback.nextElementSibling.textContent, 'Back');
  assert.equal(feedback.children.length, 0, 'success is handled by the global toast');
  await render(true, true);
  assert.equal(feedback.children.length, 0);
  assert.equal(feedback.parentElement, actions);
  await render(true);

  await render(false);
  assert.equal(panel.classList.contains('isOpen'), false);
  assert.equal(document.body.style.position, 'fixed', 'keep the background locked throughout closing');
  assert.equal(panel.querySelector('h3').textContent, 'Add Source', 'retain the closing content');
  assert.equal(closed, 0);
  await render(true);
  assert.equal(timers.size, 0, 'reopening cancels pending removal');
  await frame(); await frame();
  assert.equal(panel.classList.contains('isOpen'), true);
  await render(false);
  await act(async () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(callback => callback()); });
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.equal(document.body.style.position, '');
  assert.equal(document.activeElement, trigger);
  assert.equal(closed, 1);
});
