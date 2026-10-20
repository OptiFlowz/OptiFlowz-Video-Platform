const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { JSDOM } = require('jsdom');

test('candidate cards edit points inline and send only the moved question position, restoring the list on failure', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://test.local/quizzes' });
  const names = ['window', 'document', 'Element', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  const { act } = React, { createRoot } = require('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount()); dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  const requests = [], cache = new Map(), dirty = [], dragStarts = [];
  let rows = [
    { question_id: 'first', position: 0, max_points: 1, question: { content: 'First question', type: 'single_choice' } },
    { question_id: 'second', position: 7, max_points: 5, question: { content: 'Second question', type: 'matching' } },
  ];
  let drag, resolveOrder, rejectOrder;
  const styles = new Proxy({}, { get: (_, key) => String(key) });
  const mocks = {
    '~/i18n': { useI18n: () => ({ t: (key, params) => key === 'quizDragQuestion' ? `Drag question ${params.position}` : key }) }, '~/constants': { AddSVG: '+', MenuSVG: '=' },
    '@dnd-kit/core': {
      DndContext: props => { drag = props; return props.children; }, DragOverlay: () => null,
      useSensor: () => null, useSensors: () => [],
    },
    '@dnd-kit/sortable': {
      SortableContext: ({ children }) => children,
      useSortable: () => ({ attributes: {}, listeners: { onMouseDown: () => dragStarts.push('mouse'), onTouchStart: () => dragStarts.push('touch') }, setNodeRef() {}, setActivatorNodeRef() {} }),
    },
    '~/components/editPlaylistPage/PlaylistVideoPicker': { __esModule: true, default: () => null },
    '~/components/confirmPopup/confirmDialog': { ConfirmDialog: () => null },
    '~/components/confirmPopup/useConfirm': { useConfirm: () => ({ confirm: async () => true, dialogProps: {} }) },
    './EditorPopup': { __esModule: true, default: ({ open, children }) => open ? children : null },
    './api': { request: async (...args) => {
      requests.push(args);
      const [route, method, body] = args;
      if (method === 'PATCH' && 'position' in body) await new Promise((resolve, reject) => { resolveOrder = resolve; rejectOrder = reject; });
      if (method === 'PATCH') rows = rows.map(row => route.endsWith(`/${row.question_id}`) ? { ...row, ...body } : row);
    } },
    './shared': {
      styles, Field: ({ label, children }) => React.createElement('label', null, label, children), Select: () => null,
      Notice: ({ error }) => error ? React.createElement('p', { role: 'alert' }, error) : null, LoadState: () => null, useAccess: () => ({ read: true }),
      useAction: () => {
        const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
        return { busy, error, run: async work => { setBusy(true); setError(''); try { await work(); } catch (error) { setError(error.message); } finally { setBusy(false); } } };
      },
      useAll: (route, key) => ({ isSuccess: true, data: key === 'questions' && !route.startsWith('/questions') ? rows : [] }),
    },
  };
  function load(file) {
    file = path.resolve(file);
    if (!path.extname(file)) file += fs.existsSync(`${file}.ts`) ? '.ts' : '.tsx';
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    new Function('require', 'module', 'exports', code)(name => name in mocks ? mocks[name] : name.endsWith('.css') ? { __esModule: true, default: styles } : name.startsWith('.') ? load(path.join(path.dirname(file), name)) : require(name), mod, mod.exports);
    return mod.exports;
  }
  const { Candidates } = load('app/components/quizEngine/QuizParts.tsx');
  const props = { quiz: { id: 'quiz', user_id: 'owner' }, editable: true, onBack() {}, onDirty: value => dirty.push(value) };
  await act(async () => root.render(React.createElement(Candidates, props)));
  const badges = () => [...document.querySelectorAll('.candidatePosition')].map(el => el.textContent);
  const titles = () => [...document.querySelectorAll('.candidateCard .partText p')].map(el => el.textContent);
  assert.deepEqual(badges(), ['1', '2']);
  assert.equal(document.querySelector('[aria-label="qePosition"]'), null);
  assert.equal([...document.querySelectorAll('button')].some(button => button.textContent === 'adminEdit'), false);
  const points = document.querySelector('[aria-label="quizPoints: First question"]');
  const card = document.querySelector('.candidateCard');
  const mouseDown = element => element.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
  await act(async () => {
    mouseDown(card);
    card.dispatchEvent(new window.Event('touchstart', { bubbles: true }));
    mouseDown(document.querySelector('.candidateHandle'));
  });
  assert.deepEqual(dragStarts, ['mouse', 'touch', 'mouse']);
  await act(async () => {
    mouseDown(points);
    mouseDown(points.closest('label').querySelector('span'));
    mouseDown(document.querySelector('.partRemove'));
    points.dispatchEvent(new window.Event('touchstart', { bubbles: true }));
  });
  assert.equal(dragStarts.length, 3, 'inputs, labels and Remove do not activate card dragging');
  const input = async (element, value) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(element, value);
      element.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
  };
  await act(async () => points.focus());
  await input(points, '');
  assert.equal(points.value, '');
  assert.equal(points.validity.valueMissing, true);
  assert.equal(dirty.at(-1), true);
  await act(async () => points.blur());
  assert.deepEqual(requests, []);
  await act(async () => points.focus());
  await input(points, '2.5');
  await act(async () => points.blur());
  assert.deepEqual(requests, [['/quiz/questions/first', 'PATCH', { max_points: 2.5 }]]);
  assert.equal(dirty.at(-1), false);
  await act(async () => points.focus());
  await input(points, '');
  await act(async () => points.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  assert.equal(points.value, '2.5');
  assert.equal(dirty.at(-1), false);

  await act(async () => drag.onDragEnd({ active: { id: 'first' }, over: { id: 'second' } }));
  assert.deepEqual(requests.at(-1), ['/quiz/questions/first', 'PATCH', { position: 1 }]);
  assert.equal(requests.length, 2, 'one points write and one moved-question write');
  assert.deepEqual(titles(), ['Second question', 'First question']);
  assert.deepEqual(badges(), ['1', '2']);
  await act(async () => resolveOrder());
  assert.equal(rows.find(row => row.question_id === 'first').position, 1);
  assert.equal(rows.find(row => row.question_id === 'second').position, 7, 'no request updates another question');
  assert.equal(rows.find(row => row.question_id === 'first').max_points, 2.5);
  const savedTitles = titles();
  await act(async () => drag.onDragEnd({ active: { id: 'second' }, over: { id: 'first' } }));
  assert.deepEqual(requests.at(-1), ['/quiz/questions/second', 'PATCH', { position: 0 }]);
  assert.deepEqual(titles(), ['Second question', 'First question']);
  await act(async () => rejectOrder(new Error('Reorder failed')));
  assert.deepEqual(titles(), savedTitles);
  assert.equal(document.querySelector('[role="alert"]').textContent, 'Reorder failed');
  await act(async () => root.render(React.createElement(Candidates, { ...props, editable: false })));
  assert.equal(document.querySelector('.candidateHandle'), null);
  assert.equal(document.querySelector('input[type="number"]'), null);
  assert.equal(document.querySelector('.partRemove'), null);
  await act(async () => mouseDown(document.querySelector('.candidateCard')));
  assert.equal(dragStarts.length, 3, 'read-only cards do not activate dragging');
});
