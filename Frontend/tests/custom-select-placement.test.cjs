const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const React = require('react');
const { JSDOM } = require('jsdom');

test('a downward select stays below its trigger and focuses options without scrolling the popup', async t => {
  const dom = new JSDOM('<div id="popup" style="overflow-y: auto"><div id="root"></div></div>', { pretendToBeVisual: true });
  const names = ['window', 'document', 'HTMLElement', 'ResizeObserver', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true,
    ResizeObserver: class { observe() {} disconnect() {} },
  });
  const { act } = React, { createRoot } = require('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  const compiled = ts.transpileModule(fs.readFileSync('app/components/customSelect/customSelect.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(require, loaded, loaded.exports);
  const Select = loaded.exports.default;
  const selected = [];
  await act(async () => root.render(React.createElement(Select, {
    ariaLabel: 'Question type', value: 'matching', placement: 'bottom',
    options: [{ value: 'single', label: 'Single choice' }, { value: 'multiple', label: 'Multiple choice' }, { value: 'matching', label: 'Matching' }],
    onChange: value => selected.push(value),
  })));
  const popup = document.getElementById('popup'), select = document.querySelector('.customSelect');
  popup.getBoundingClientRect = () => ({ top: 0, left: 0 });
  Object.defineProperty(popup, 'clientHeight', { value: 560 });
  popup.scrollTop = 90;
  select.getBoundingClientRect = () => ({ top: 400, bottom: 440, left: 20, right: 240 });
  const scroller = document.querySelector('[role="listbox"]');
  Object.defineProperty(scroller, 'clientHeight', { value: 80 });
  const options = [...document.querySelectorAll('[role="option"]')];
  const focusCalls = [];
  options.forEach((option, index) => {
    Object.defineProperties(option, { offsetTop: { value: index * 40 }, offsetHeight: { value: 40 } });
    const focus = option.focus.bind(option);
    option.focus = settings => { focusCalls.push(settings); focus(settings); };
  });
  await act(async () => document.querySelector('.customSelectTrigger').click());
  await act(async () => new Promise(resolve => window.requestAnimationFrame(resolve)));
  assert.equal(document.querySelector('.customSelectMenu').classList.contains('opensUpward'), false);
  assert.equal(scroller.style.maxHeight, '108px');
  assert.equal(document.activeElement, options[2]);
  assert.deepEqual(focusCalls, [{ preventScroll: true }]);
  assert.equal(scroller.scrollTop, 40);
  assert.equal(popup.scrollTop, 90);
  await act(async () => options[2].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })));
  assert.equal(document.activeElement, options[1]);
  assert.equal(popup.scrollTop, 90);
  await act(async () => options[1].click());
  assert.deepEqual(selected, ['multiple']);
  assert.equal(document.querySelector('.customSelectTrigger').getAttribute('aria-expanded'), 'false');

  const categoryProps = {
    ariaLabel: 'Question category', value: '',
    options: [
      { value: '', label: 'Select', disabled: true, hidden: true },
      { value: 'used', label: 'Already used category', disabled: true },
      { value: 'first', label: 'First category' },
      { value: 'second', label: 'Second category' },
    ],
    onChange: value => selected.push(value),
  };
  await act(async () => root.render(React.createElement(Select, categoryProps)));
  assert.equal(document.querySelector('.customSelectValue').textContent, 'Select', 'the empty field retains its prompt');
  const categoryOptions = [...document.querySelectorAll('[role="option"]')];
  assert.deepEqual(categoryOptions.map(option => option.textContent), ['Already used category', 'First category', 'Second category']);
  assert.equal(categoryOptions[0].disabled, true, 'unavailable categories remain visible and disabled');
  await act(async () => document.querySelector('.customSelectTrigger').click());
  await act(async () => new Promise(resolve => window.requestAnimationFrame(resolve)));
  assert.equal(document.activeElement, categoryOptions[1], 'opening skips the hidden placeholder and disabled category');
  await act(async () => categoryOptions[1].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })));
  assert.equal(document.activeElement, categoryOptions[2], 'keyboard navigation wraps among visible enabled options');
  await act(async () => categoryOptions[2].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  assert.equal(selected.at(-1), 'second');
  await act(async () => root.render(React.createElement(Select, { ...categoryProps, value: 'second' })));
  assert.equal(document.querySelector('.customSelectValue').textContent, 'Second category');
});
