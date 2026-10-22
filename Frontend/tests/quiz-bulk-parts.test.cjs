const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { JSDOM } = require('jsdom');

test('sources and rules support selection, confirmed bulk removal, and safe retries', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://test.local/quizzes' });
  const names = ['window', 'document', 'Element', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  const { act } = React, { createRoot } = require('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount()); dom.window.close();
    for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  const writes = [], dirty = [], cache = new Map();
  let rejectSave = false, allowRemove = true, rejectId = 'video2';
  let serverSources = [{ category_id: 'cat1', position: 0, question_count: 1, max_points: null }, { category_id: null, position: 1, question_count: 2, max_points: null }, { category_id: 'cat3', position: 2, question_count: 3, max_points: null }];
  let rows = [{ quiz_id: 'quiz', video_id: 'video', position: 3, min_watch_percentage: 50, min_watch_seconds: null, video_card: { id: 'video', title: 'Video', duration_seconds: 120 } }];
  rows = [1, 2, 3].map(n => ({ ...rows[0], video_id: `video${n}`, video_card: { ...rows[0].video_card, title: `Video ${n}` } }));
  const styles = new Proxy({}, { get: (_, key) => String(key) });
  const mocks = {
    '~/functions': { formatDuration: seconds => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` },
    '~/i18n': { useI18n: () => ({ t: key => key }) }, '~/constants': { AddSVG: '+', DeleteSVG: 'delete' },
    '~/components/editPlaylistPage/PlaylistVideoPicker': { __esModule: true, default: ({ onAdd, busy }) => React.createElement('button', { 'data-pick-video': true, disabled: busy, onClick: () => onAdd({ id: 'replacement', title: 'Replacement', duration_seconds: 120 }) }, 'Pick video') },
    '~/components/confirmPopup/confirmDialog': { ConfirmDialog: () => null },
    '~/components/confirmPopup/useConfirm': { useConfirm: () => ({ confirm: async () => allowRemove, dialogProps: {} }) },
    './CandidateList': { __esModule: true, default: () => null }, './QuestionEditor': { __esModule: true, default: () => null },
    './EditorPopup': { __esModule: true, default: ({ open, children, onAfterClose }) => { React.useEffect(() => { if (!open) onAfterClose?.(); }, [open]); return open ? React.createElement('div', { role: 'dialog' }, children) : null; }, EditorActions: ({ children }) => React.createElement('div', null, children) },
    './api': { request: async (route, method, body) => {
      writes.push([route, method, body]);
      if (rejectSave || (method === 'DELETE' && route.endsWith('/' + rejectId))) throw new Error('Save failed');
      if (method === 'PUT') { serverSources = body.sources; return { sources: serverSources }; }
      if (method === 'PATCH') rows = rows.map(row => route.endsWith('/' + row.video_id) ? { ...row, ...body } : row);
      if (method === 'POST') rows.push({ ...body, video_card: { id: body.video_id, title: 'Replacement', duration_seconds: 120 } });
      if (method === 'DELETE') rows = rows.filter(row => !route.endsWith('/' + row.video_id));
    } },
    './shared': {
      styles, Field: ({ label, children }) => React.createElement('label', null, label, children),
      Select: ({ label, value, values, onChange, disabled }) => React.createElement('select', { 'aria-label': label, value, disabled, onChange: e => onChange(e.target.value) }, values.map(option => React.createElement('option', { key: option.value, value: option.value }, option.label))),
      Notice: ({ error }) => error ? React.createElement('p', { role: 'alert' }, error) : null, LoadState: () => null,
      useAccess: () => ({ read: true }),
      useAll: route => ({ data: route.includes('quiz-requirements') ? rows : route.endsWith('/sources') ? serverSources : [], isSuccess: true }),
      useAction: () => {
        const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
        return { busy, error, run: async work => { setBusy(true); setError(''); try { await work(); } catch (error) { setError(error.message); } finally { setBusy(false); } } };
      },
    },
  };
  function load(file) {
    file = path.resolve(file);
    if (!path.extname(file)) file += fs.existsSync(file + '.ts') ? '.ts' : '.tsx';
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    new Function('require', 'module', 'exports', code)(name => name in mocks ? mocks[name] : name.endsWith('.css') ? { __esModule: true, default: styles } : name.startsWith('.') ? load(path.join(path.dirname(file), name)) : require(name), mod, mod.exports);
    return mod.exports;
  }
  const { Requirements, Sources } = load('app/components/quizEngine/QuizParts.tsx');
  const props = { quiz: { id: 'quiz', user_id: 'me' }, editable: true, onDirty: value => dirty.push(value) };
  await act(async () => root.render(React.createElement(Requirements, props)));
  const click = async element => act(async () => element.click());
  const all = () => document.querySelector('.partHeader input');
  const checks = () => [...document.querySelectorAll('article input.candidateCheckbox')];
  const remove = () => document.querySelector('.candidateBulk button');
  assert.equal(all().checked, false);
  await click(checks()[0]);
  assert.equal(all().indeterminate, true);
  assert.equal(dirty.length, 0, 'selection alone does not dirty the editor');
  await click(all());
  assert.equal(checks().every(input => input.checked), true);
  assert.equal(all().checked, true);
  assert.equal(all().indeterminate, false);
  allowRemove = false;
  await click(remove());
  assert.equal(writes.length, 0, 'cancelling leaves selected rules untouched');
  allowRemove = true;
  await click(remove());
  assert.equal(rows.length, 2, 'successful first deletion survives a later failure');
  assert.equal(checks().every(input => input.checked), true, 'failed and unprocessed rules stay selected');
  assert.equal(document.querySelector('[role="alert"]').textContent, 'Save failed');
  rejectId = '';
  await click(remove());
  assert.equal(writes.filter(([route]) => route.endsWith('/video1')).length, 1, 'retry does not repeat completed deletion');
  assert.equal(rows.length, 0);
  assert.equal(all().disabled, true);
  assert.equal(remove().disabled, true);
  await act(async () => root.render(React.createElement(Sources, props)));
  assert.equal(checks().length, 3);
  await click(checks()[0]); await click(checks()[1]);
  assert.equal(all().indeterminate, true);
  allowRemove = false;
  await click(remove());
  assert.equal(checks().length, 3);
  allowRemove = true;
  const before = writes.length;
  await click(remove());
  assert.equal(checks().length, 1);
  assert.equal(writes.length, before, 'source removals remain drafts until Save changes');
  assert.equal(dirty.at(-1), true);
  assert.equal(all().checked, false);
  await click(document.querySelector('.saveCaptionsBtn'));
  assert.deepEqual(writes.at(-1), ['/quiz/sources', 'PUT', { sources: [{ category_id: 'cat3', position: 2, question_count: 3, max_points: null }] }]);
  assert.equal(dirty.at(-1), false);
  await click(all()); await click(remove());
  assert.equal(checks().length, 0);
  assert.equal(all().disabled, true);
  await click(document.querySelector('.saveCaptionsBtn'));
  assert.deepEqual(serverSources, []);
  await act(async () => root.render(React.createElement(Sources, { ...props, editable: false })));
  assert.equal(all(), null);
  assert.equal(remove(), null);
  await act(async () => root.render(React.createElement(Requirements, { ...props, editable: false })));
  assert.equal(all(), null);
  assert.equal(remove(), null);
});
