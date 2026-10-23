const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const React = require('react');
const { JSDOM } = require('jsdom');

test('opening CSS with server line endings stays clean; only real edits notify the form', async t => {
  const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
  const globals = { window: dom.window, document: dom.window.document, CSS: { supports: () => false }, IS_REACT_ACT_ENVIRONMENT: true };
  for (const name of ['MutationObserver', 'Window', 'Document', 'Node', 'Text', 'Element', 'HTMLElement', 'DOMRect', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) globals[name] = typeof dom.window[name] === 'function' && /^[a-z]/.test(name) ? dom.window[name].bind(dom.window) : dom.window[name];
  const previous = new Map(Object.keys(globals).map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.assign(globalThis, globals);
  dom.window.Range.prototype.getClientRects = () => [];
  dom.window.Range.prototype.getBoundingClientRect = () => new dom.window.DOMRect();
  const { createRoot } = require('react-dom/client'), { EditorView } = require('@codemirror/view'), { undo } = require('@codemirror/commands');
  const root = createRoot(document.getElementById('root')), { act } = React;
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  const cache = new Map();
  function load(file) {
    if (!path.extname(file)) file += fs.existsSync(file + '.ts') ? '.ts' : '.tsx';
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    new Function('require', 'module', 'exports', code)(name => name.endsWith('.css') ? { default: {} } : name === './ColorPicker' ? { default: () => null } : name.startsWith('.') ? load(path.resolve(path.dirname(file), name)) : require(name), mod, mod.exports);
    return mod.exports;
  }
  const Editor = load(path.resolve('app/components/cssColorEditor/CssColorEditor.tsx')).default;
  const changes = [];
  const render = async (key, value, disabled, language = 'css') => act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(Editor, { key, label: 'CSS', value, disabled, language, onChange: next => changes.push(next) }))));
  for (const [index, ending] of ['\n', '\r\n', '\r'].entries()) {
    const source = `.modern {${ending}  color: blue;${ending}}`;
    await render(index, source, true);
    assert.deepEqual(changes, [], 'mounting read-only system CSS must not mark the template dirty');
    assert.ok(document.querySelector('.cm-line span[class]'), 'CSS has syntax highlighting');
    await render(index, source, false);
    assert.deepEqual(changes, [], 'changing editability must not rewrite CSS');
    const updated = source.replace('blue', 'red');
    await render(index, updated, false);
    assert.deepEqual(changes, [], 'external data refresh must not emit user changes');
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor'));
    assert.equal(view.state.doc.toString(), updated.replace(/\r\n?|\n/g, '\n'));
    const from = view.state.doc.toString().indexOf('red');
    await act(async () => view.dispatch({ changes: { from, to: from + 3, insert: 'green' }, userEvent: 'input' }));
    assert.deepEqual(changes, [updated.replace(/\r\n?|\n/g, '\n').replace('red', 'green')]);
    await act(async () => undo(view));
    assert.equal(changes.at(-1), updated.replace(/\r\n?|\n/g, '\n'));
    assert.equal(undo(view), false, 'external synchronization is not an undoable edit');
    changes.length = 0;
  }
  const markup = '<!-- certificate -->\r\n<div class="certificate"><h1>{{user.full_name}}</h1></div>';
  await render('html', markup, true, 'html');
  assert.deepEqual(changes, [], 'HTML highlights without emitting an edit');
  const tokens = [...document.querySelectorAll('.cm-line span[class]')];
  assert.ok(tokens.some(node => node.textContent === 'div'), 'HTML tags are highlighted');
  assert.ok(tokens.some(node => node.textContent === 'class'), 'HTML attributes are highlighted');
  assert.ok(new Set(tokens.map(node => node.className)).size >= 3, 'distinct syntax categories have different styles');
  assert.equal(document.querySelector('.cm-content button'), null, 'HTML does not get CSS swatches');
  await render('html', markup, false, 'html');
  const view = EditorView.findFromDOM(document.querySelector('.cm-editor'));
  await act(async () => view.dispatch({ changes: { from: view.state.doc.length, insert: '<p>Done</p>' }, userEvent: 'input' }));
  assert.equal(changes.length, 1);
  assert.ok(changes[0].endsWith('<p>Done</p>'));
});
