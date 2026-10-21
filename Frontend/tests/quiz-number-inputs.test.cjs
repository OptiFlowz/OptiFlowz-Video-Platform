const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { JSDOM } = require('jsdom');

test('question changes stay pending until one batch save, cancel restores them and failures preserve the draft', async t => {
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
    { question_id: 'third', position: 9, max_points: 10, question: { content: 'Third question', type: 'matching' } },
  ];
  const originalRows = structuredClone(rows);
  const bank = [...rows.map(row => ({ ...row.question, id: row.question_id, user_id: 'owner' })), { id: 'fourth', user_id: 'owner', content: 'Fourth question', type: 'single_choice' }];
  let drag, resolveSave, rejectSave;
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
    './EditorPopup': { __esModule: true, default: ({ open, children }) => open ? children : null, EditorActions: ({ children }) => React.createElement('div', null, children) },
    './api': { request: async (...args) => {
      requests.push(args);
      const [route, method, body] = args;
      assert.equal(route, '/quiz/questions');
      assert.equal(method, 'PUT');
      await new Promise((resolve, reject) => { resolveSave = resolve; rejectSave = reject; });
      rows = body.questions.map(row => ({ ...row, question: bank.find(question => question.id === row.question_id) }));
      return { questions: rows };
    } },
    './shared': {
      styles, Field: ({ label, children }) => React.createElement('label', null, label, children), Select: () => null,
      Notice: ({ error, busy }) => error ? React.createElement('p', { role: 'alert' }, error) : busy ? React.createElement('p', { role: 'status' }, 'Saving...') : null,
      LoadState: () => null, useAccess: () => ({ read: true }),
      useAction: () => {
        const [busy, setBusy] = React.useState(false), [error, setError] = React.useState(''), [success, setSuccess] = React.useState('');
        return { busy, error, success, setError, setSuccess, run: async work => { setBusy(true); setError(''); try { await work(); setSuccess('Saved'); } catch (error) { setError(error.message); } finally { setBusy(false); } } };
      },
      useAll: (route, key) => ({ isSuccess: true, data: key === 'sources' ? [{ position: 3 }] : route === '/questions' ? bank : rows }),
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
  assert.deepEqual(badges(), ['1', '2', '3']);
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
  const saveButton = () => document.querySelector('.candidateSaveActions .saveCaptionsBtn');
  const cancelButton = () => document.querySelector('.candidateSaveActions .cancelBtn');
  const click = async element => act(async () => element.click());
  const pointsFor = name => document.querySelector(`[aria-label="quizPoints: ${name} question"]`);
  const remove = name => document.querySelector(`[aria-label="quizRemove: ${name} question"]`);
  assert.equal(saveButton().disabled, true);
  assert.equal(cancelButton().disabled, true);
  await input(points, '');
  assert.equal(points.value, '');
  assert.equal(points.validity.valueMissing, true);
  assert.equal(dirty.at(-1), true);
  assert.equal(saveButton().disabled, true);
  await input(points, '2.5');
  await act(async () => points.blur());
  await act(async () => drag.onDragEnd({ active: { id: 'first' }, over: { id: 'second' } }));
  await click(remove('Third'));
  assert.deepEqual(titles(), ['Second question', 'First question']);
  assert.deepEqual(requests, [], 'points, moving and removing do not send individual requests');
  assert.equal(dirty.at(-1), true);
  await click(cancelButton());
  assert.deepEqual(titles(), ['First question', 'Second question', 'Third question']);
  assert.equal(pointsFor('First').value, '1');
  assert.equal(dirty.at(-1), false);
  assert.deepEqual(requests, []);

  await input(pointsFor('First'), '2.5');
  await act(async () => drag.onDragEnd({ active: { id: 'first' }, over: { id: 'second' } }));
  await click(remove('Third'));
  await click(document.querySelector('.partAdd'));
  await click(document.querySelector('[aria-label="quizAddQuestion: Fourth question"]'));
  assert.deepEqual(requests, [], 'adding a question joins the pending changes');
  await click([...document.querySelectorAll('button')].find(button => button.textContent === 'back'));
  assert.deepEqual(titles(), ['Second question', 'First question', 'Fourth question']);
  await input(pointsFor('First'), '1.001');
  assert.equal(saveButton().disabled, true, 'unsupported point precision cannot be submitted');
  await input(pointsFor('First'), '2.5');
  await click(saveButton());
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], ['/quiz/questions', 'PUT', {
    questions: [
      { question_id: 'second', position: 0, max_points: 5 },
      { question_id: 'first', position: 7, max_points: 2.5 },
      { question_id: 'fourth', position: 8, max_points: 1 },
    ],
    expected_questions: originalRows.map(({ question_id, position, max_points }) => ({ question_id, position, max_points })),
  }]);
  assert.equal(saveButton().disabled, true);
  assert.equal(cancelButton().disabled, true);
  assert.equal(document.querySelector('[role="status"]').textContent, 'Saving...');
  await act(async () => rejectSave(new Error('Save failed')));
  assert.equal(document.querySelector('[role="alert"]').textContent, 'Save failed');
  assert.deepEqual(titles(), ['Second question', 'First question', 'Fourth question']);
  assert.equal(pointsFor('First').value, '2.5');
  assert.equal(dirty.at(-1), true);
  assert.equal(saveButton().disabled, false);
  await click(saveButton());
  await act(async () => resolveSave());
  assert.deepEqual(titles(), ['Second question', 'First question', 'Fourth question']);
  assert.equal(dirty.at(-1), false);
  assert.equal(saveButton().disabled, true);
  assert.equal(rows.some(row => row.question_id === 'third'), false);
  assert.equal(rows.find(row => row.question_id === 'first').max_points, 2.5);

  await input(pointsFor('First'), '4.5');
  rows = rows.map(row => row.question_id === 'first' ? { ...row, max_points: 100 } : row);
  await act(async () => root.render(React.createElement(Candidates, props)));
  assert.equal(pointsFor('First').value, '4.5', 'background refreshes preserve pending edits');
  await click(cancelButton());
  assert.equal(pointsFor('First').value, '100', 'cancel restores the latest saved data');
  for (const name of ['First', 'Second', 'Fourth']) await click(remove(name));
  assert.equal(document.querySelectorAll('.candidateCard').length, 0);
  assert.equal(saveButton().disabled, false, 'removing every fixed question is a valid pending change');
  await click(saveButton());
  assert.deepEqual(requests.at(-1)[2].questions, []);
  await act(async () => resolveSave());
  assert.deepEqual(rows, []);
  assert.equal(dirty.at(-1), false);

  rows = structuredClone(originalRows);
  await act(async () => root.render(React.createElement(Candidates, { ...props, editable: false })));
  assert.equal(document.querySelector('.candidateHandle'), null);
  assert.equal(document.querySelector('input[type="number"]'), null);
  assert.equal(document.querySelector('.partRemove'), null);
  assert.equal(document.querySelector('.candidateSaveActions'), null);
  await act(async () => mouseDown(document.querySelector('.candidateCard')));
  assert.equal(dragStarts.length, 3, 'read-only cards do not activate dragging');
});

test('pending question order handles tied positions at the integer boundary', () => {
  const code = ts.transpileModule(fs.readFileSync('app/components/quizEngine/candidateDraft.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', code)(mod, mod.exports);
  const { moveCandidate, candidatesValid } = mod.exports;
  const rows = [{ question_id: 'first', position: 2147483647, max_points: 1 }, { question_id: 'second', position: 2147483647, max_points: 2 }];
  const reordered = moveCandidate(rows, 'second', 'first');
  assert.deepEqual(reordered.map(row => row.question_id), ['second', 'first']);
  assert.deepEqual(reordered.map(row => row.position), [2147483646, 2147483647]);
  assert.equal(candidatesValid(reordered), true);
  assert.deepEqual(rows.map(row => row.position), [2147483647, 2147483647], 'the saved baseline stays intact');
});
