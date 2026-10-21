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
  const bank = [{ id: 'third', user_id: 'owner', content: 'Third question', type: 'single_choice' }];
  let failRemoval = false;
  let drag, resolveOrder, rejectOrder, rejectPoints = false, allowRemove = true, canEditQuestion = true;
  const styles = new Proxy({}, { get: (_, key) => String(key) });
  const mocks = {
    '~/functions': { formatDuration: seconds => String(seconds) },
    '~/i18n': { useI18n: () => ({ t: (key, params) => key === 'quizDragQuestion' ? `Drag question ${params.position}` : key }) }, '~/constants': { AddSVG: '+', MenuSVG: '=', EditSVG: 'pencil' },
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
    '~/components/confirmPopup/useConfirm': { useConfirm: () => ({ confirm: async () => allowRemove, dialogProps: {} }) },
    './EditorPopup': { __esModule: true, default: ({ open, children }) => open ? children : null, EditorActions: ({ children }) => React.createElement('div', null, children) },
    './QuestionEditor': { __esModule: true, default: ({ id, onDirty, onClose, onSaved }) => React.createElement('div', { 'data-editing-question': id },
      React.createElement('button', { 'data-change-question': true, onClick: () => onDirty(true) }, 'Change'),
      React.createElement('button', { 'data-close-question': true, onClick: onClose }, 'Close'),
      React.createElement('button', { 'data-save-question': true, onClick: () => { rows = rows.map(row => row.question_id === id ? { ...row, question: { ...row.question, content: 'Updated question' } } : row); onDirty(false); onSaved(id); } }, 'Save')) },
    './api': { request: async (...args) => {
      requests.push(args);
      const [route, method, body] = args;
      if (method === 'PATCH' && 'position' in body) await new Promise((resolve, reject) => { resolveOrder = resolve; rejectOrder = reject; });
      if (method === 'PATCH') {
        if ('max_points' in body && rejectPoints) throw new Error('Points failed');
        const moved = rows.find(row => route.endsWith(`/${row.question_id}`));
        const previousPosition = moved.position;
        rows = rows.map(row => {
          if (row === moved) return { ...row, ...body };
          if (body.position < previousPosition && row.position >= body.position && row.position < previousPosition) return { ...row, position: row.position + 1 };
          if (body.position > previousPosition && row.position > previousPosition && row.position <= body.position) return { ...row, position: row.position - 1 };
          return row;
        });
      }
      if (method === 'POST') rows = [...rows, { ...body, question: bank.find(question => question.id === body.question_id) }];
      if (method === 'DELETE' && failRemoval && route.endsWith('/first')) throw new Error('Removal failed');
      if (method === 'DELETE') rows = rows.filter(row => !route.endsWith(`/${row.question_id}`));
    } },
    './shared': {
      styles, FieldHelp: () => null, Field: ({ label, children }) => React.createElement('label', null, label, children), Select: () => null,
      Notice: ({ error }) => error ? React.createElement('p', { role: 'alert' }, error) : null, LoadState: () => null, useAccess: () => ({ read: true, canOwn: () => canEditQuestion }),
      useAction: () => {
        const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
        return { busy, error, run: async work => { setBusy(true); setError(''); try { await work(); } catch (error) { setError(error.message); } finally { setBusy(false); } } };
      },
      useAll: (route, key) => ({ isSuccess: true, data: key === 'sources' ? [{ position: 10 }] : route === '/questions' ? bank : rows }),
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
  const titles = () => [...document.querySelectorAll('.candidateCard .candidateContent p')].map(el => el.textContent);
  assert.deepEqual(badges(), ['1', '2']);
  assert.equal(document.querySelector('.saveCaptionsBtn'), null, 'question changes do not need a separate Save button');
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
    mouseDown(points.closest('.candidatePoints').querySelector('label'));
    mouseDown(document.querySelector('.partRemove'));
    mouseDown(document.querySelector('.candidateEdit'));
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
  assert.deepEqual(requests.at(-1), ['/quiz/questions/first', 'PATCH', { position: 7 }]);
  assert.equal(requests.length, 2, 'one points write and one moved-question write');
  assert.deepEqual(titles(), ['Second question', 'First question']);
  assert.deepEqual(badges(), ['1', '2']);
  await act(async () => drag.onDragEnd({ active: { id: 'second' }, over: { id: 'first' } }));
  assert.equal(requests.length, 2, 'ignore another move while the first is saving');
  await act(async () => resolveOrder());
  assert.equal(rows.find(row => row.question_id === 'first').position, 7);
  assert.equal(rows.find(row => row.question_id === 'second').position, 6, 'the backend shifts the other question in the same request');
  assert.equal(rows.find(row => row.question_id === 'first').max_points, 2.5);
  const savedTitles = titles();
  await act(async () => drag.onDragEnd({ active: { id: 'second' }, over: { id: 'first' } }));
  assert.deepEqual(requests.at(-1), ['/quiz/questions/second', 'PATCH', { position: 7 }]);
  assert.deepEqual(titles(), ['First question', 'Second question']);
  await act(async () => rejectOrder(new Error('Reorder failed')));
  assert.deepEqual(titles(), savedTitles);
  assert.equal(document.querySelector('[role="alert"]').textContent, 'Reorder failed');
  const pointsFor = () => document.querySelector('[aria-label="quizPoints: First question"]');
  const blurPoints = async () => act(async () => pointsFor().blur());
  const focusPoints = async () => act(async () => pointsFor().focus());
  const beforeInvalid = requests.length;
  await focusPoints(); await input(pointsFor(), '1.001'); await blurPoints();
  assert.equal(requests.length, beforeInvalid, 'invalid point precision is not saved');
  rejectPoints = true;
  await focusPoints(); await input(pointsFor(), '4.5'); await blurPoints();
  assert.equal(pointsFor().value, '4.5', 'failed save keeps the entered value for retry');
  assert.equal(dirty.at(-1), true);
  assert.equal(document.querySelector('[role="alert"]').textContent, 'Points failed');
  rejectPoints = false;
  await focusPoints(); await blurPoints();
  assert.equal(rows.find(row => row.question_id === 'first').max_points, 4.5);
  assert.equal(dirty.at(-1), false);
  const click = async element => act(async () => element.click());
  await click(document.querySelector('.partAdd'));
  await click(document.querySelector('[aria-label="quizAddQuestion: Third question"]'));
  assert.deepEqual(requests.at(-1), ['/quiz/questions', 'POST', { question_id: 'third', position: 11 }]);
  assert.ok(rows.some(row => row.question_id === 'third'));
  const beforeRemove = requests.length;
  allowRemove = false;
  await click(document.querySelector('[aria-label="quizRemove: Third question"]'));
  assert.equal(requests.length, beforeRemove, 'cancelling removal does not write');
  allowRemove = true;
  await click(document.querySelector('[aria-label="quizRemove: Third question"]'));
  assert.deepEqual(requests.at(-1), ['/quiz/questions/third', 'DELETE']);
  assert.equal(rows.some(row => row.question_id === 'third'), false);
  assert.equal(requests.some(([, method]) => method === 'PUT'), false);
  const editButton = document.querySelector('[aria-label="adminEdit: First question"]');
  assert.equal(editButton.previousElementSibling.className, 'candidatePoints', 'Edit follows Points');
  assert.equal(editButton.nextElementSibling.className, 'partRemove', 'Edit precedes Remove');
  await click(editButton);
  assert.equal(document.querySelector('[data-editing-question]').dataset.editingQuestion, 'first');
  await click(document.querySelector('[data-change-question]'));
  assert.equal(dirty.at(-1), true);
  allowRemove = false;
  await click(document.querySelector('[data-close-question]'));
  assert.ok(document.querySelector('[data-editing-question]'), 'cancelled discard keeps the editor open');
  allowRemove = true;
  await click(document.querySelector('[data-close-question]'));
  assert.equal(document.querySelector('[data-editing-question]'), null);
  assert.equal(dirty.at(-1), false);
  await click(document.querySelector('[aria-label="adminEdit: First question"]'));
  await click(document.querySelector('[data-save-question]'));
  assert.equal(document.querySelector('[data-editing-question]'), null);
  assert.ok(titles().includes('Updated question'), 'refreshed question appears in its existing quiz row');
  assert.equal(rows.find(row => row.question_id === 'first').max_points, 4.5);
  // Bulk removal uses only quiz links and retains the failed selection for retry.
  const originalRows = [...rows];
  await click(document.querySelector('[aria-label="qeSelectAll"]'));
  assert.equal(document.querySelectorAll('.candidateCard input[type="checkbox"]:checked').length, 2);
  await click(document.querySelector('.candidateCard input[type="checkbox"]'));
  assert.equal(document.querySelector('[aria-label="qeSelectAll"]').indeterminate, true);
  await click(document.querySelector('[aria-label="qeSelectAll"]'));
  const beforeBulk = requests.length;
  allowRemove = false;
  await click(document.querySelector('.candidateBulk button'));
  assert.equal(requests.length, beforeBulk);
  allowRemove = true; failRemoval = true;
  await click(document.querySelector('.candidateBulk button'));
  assert.equal(rows.length, 1, 'successful deletion is retained when the second fails');
  assert.equal(document.querySelector('.candidateCard input[type="checkbox"]').checked, true);
  assert.equal(document.querySelector('[role="alert"]').textContent, 'Removal failed');
  failRemoval = false;
  await click(document.querySelector('.candidateBulk button'));
  assert.equal(rows.length, 0);
  assert.deepEqual(requests.slice(beforeBulk).map(([route]) => route), ['/quiz/questions/second', '/quiz/questions/first', '/quiz/questions/first']);
  rows = originalRows;
  canEditQuestion = false;
  await act(async () => root.render(React.createElement(Candidates, props)));
  assert.equal(document.querySelector('.candidateEdit'), null, 'question editing requires question update permission');
  await act(async () => root.render(React.createElement(Candidates, { ...props, editable: false })));
  assert.equal(document.querySelector('.candidateHandle'), null);
  assert.equal(document.querySelector('input[type="number"]'), null);
  assert.equal(document.querySelector('.partRemove'), null);
  await act(async () => mouseDown(document.querySelector('.candidateCard')));
  assert.equal(dragStarts.length, 3, 'read-only cards do not activate dragging');
});
