const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const React = require('react');
const { JSDOM } = require('jsdom');

test('confirmation paints before entering and resolves only after its exit, including interrupted transitions', async t => {
  const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
  const frames = new Map(), timers = new Map();
  let nextId = 0;
  const globals = {
    window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    requestAnimationFrame: callback => { const id = ++nextId; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id), IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(globals).map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.assign(globalThis, globals);
  window.setTimeout = (callback, delay) => { const id = ++nextId; timers.set(id, { callback, delay }); return id; };
  window.clearTimeout = id => timers.delete(id);
  const { act } = React, { createRoot } = require('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount()); dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
  });
  function load(file) {
    const mod = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(path.resolve(file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    new Function('require', 'module', 'exports', code)(name => name === '~/i18n' ? { useI18n: () => ({ t: key => key }) } : require(name), mod, mod.exports);
    return mod.exports;
  }
  const { ConfirmDialog } = load('app/components/confirmPopup/confirmDialog.tsx');
  const { useConfirm } = load('app/components/confirmPopup/useConfirm.tsx');
  const results = [];
  let api;
  function Harness() {
    api = useConfirm();
    return React.createElement(ConfirmDialog, api.dialogProps);
  }
  const frame = async () => {
    const pending = [...frames.values()]; frames.clear();
    await act(async () => pending.forEach(callback => callback()));
  };
  const transition = async (element, propertyName = 'opacity') => act(async () => {
    const event = new window.Event('transitionend', { bubbles: true });
    Object.defineProperty(event, 'propertyName', { value: propertyName }); element.dispatchEvent(event);
  });
  const open = async name => act(async () => { void api.confirm({ title: name, yesText: 'Delete', noText: 'Cancel' }).then(value => results.push(value)); });
  await act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(Harness))));
  assert.equal(document.querySelector('[role=dialog]'), null);
  await open('Delete template');
  const layer = document.querySelector('[role=dialog]'), panel = layer.querySelector('.popupMotionPanel');
  assert.equal(panel.classList.contains('isOpen'), false);
  await frame(); assert.equal(panel.classList.contains('isOpen'), false);
  await frame(); assert.equal(panel.classList.contains('isOpen'), true);
  await act(async () => [...panel.querySelectorAll('button')].find(button => button.textContent === 'Cancel').click());
  assert.deepEqual(results, [], 'the caller must not unmount the popup before its exit');
  assert.ok(document.contains(panel));
  assert.equal(panel.classList.contains('isOpen'), false);
  await transition(panel.querySelector('button'));
  await transition(panel, 'transform');
  assert.deepEqual(results, [], 'only the panel opacity transition completes the close');
  await transition(panel);
  assert.deepEqual(results, [false]);
  assert.equal(document.querySelector('[role=dialog]'), null);
  assert.equal(timers.size, 0);

  await open('Confirm deletion'); await frame(); await frame();
  const nextPanel = document.querySelector('.popupMotionPanel');
  await act(async () => [...nextPanel.querySelectorAll('button')].find(button => button.textContent === 'Delete').click());
  assert.deepEqual(results, [false], 'acceptance also waits for the exit');
  await act(async () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(timer => timer.callback()); });
  assert.deepEqual(results, [false, true], 'a fallback finishes exits without transitionend');
  assert.equal(document.querySelector('[role=dialog]'), null);

  let setOpen;
  const closed = [];
  function Controlled() {
    const [open, update] = React.useState(true); setOpen = update;
    return React.createElement(ConfirmDialog, { open, onYes() {}, onNo() {}, onAfterClose: () => closed.push(true) });
  }
  await act(async () => root.render(React.createElement(Controlled)));
  await frame(); await frame();
  await act(async () => setOpen(false));
  const interrupted = document.querySelector('.popupMotionPanel');
  await act(async () => setOpen(true));
  assert.equal(timers.size, 0, 'reopening cancels pending removal');
  await frame(); await frame();
  await transition(interrupted);
  assert.ok(document.contains(interrupted), 'a stale transition cannot remove a reopened panel');
  assert.deepEqual(closed, []);
});
