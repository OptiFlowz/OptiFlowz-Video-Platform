const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { JSDOM } = require('jsdom');

test('rules edit in a popup, validate, cancel and retry drafts, and preserve video replacement writes', async t => {
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
  let rejectSave = false, allowRemove = true;
  let rows = [{ quiz_id: 'quiz', video_id: 'video', position: 3, min_watch_percentage: 50, min_watch_seconds: null, video_card: { id: 'video', title: 'Video', duration_seconds: 120 } }];
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
      if (rejectSave) throw new Error('Save failed');
      if (method === 'PATCH') rows = rows.map(row => route.endsWith('/' + row.video_id) ? { ...row, ...body } : row);
      if (method === 'POST') rows.push({ ...body, video_card: { id: body.video_id, title: 'Replacement', duration_seconds: 120 } });
      if (method === 'DELETE') rows = rows.filter(row => !route.endsWith('/' + row.video_id));
    } },
    './shared': {
      styles, Field: ({ label, children }) => React.createElement('label', null, label, children),
      Select: ({ label, value, values, onChange, disabled }) => React.createElement('select', { 'aria-label': label, value, disabled, onChange: e => onChange(e.target.value) }, values.map(option => React.createElement('option', { key: option.value, value: option.value }, option.label))),
      Notice: ({ error }) => error ? React.createElement('p', { role: 'alert' }, error) : null, LoadState: () => null,
      useAll: () => ({ data: rows, isSuccess: true }),
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
  const { Requirements } = load('app/components/quizEngine/QuizParts.tsx');
  const props = { quiz: { id: 'quiz', user_id: 'me' }, editable: true, onDirty: value => dirty.push(value) };
  await act(async () => root.render(React.createElement(Requirements, props)));
  const click = async element => act(async () => element.click());
  const input = () => document.querySelector('input[type="number"]');
  const setValue = async value => act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input(), value);
    input().dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  const edit = () => document.querySelector('[aria-label="quizEditRule: Video"]');
  const save = () => document.querySelector('[role="dialog"] button[type="submit"]');
  const cancel = () => document.querySelector('[role="dialog"] .cancelBtn');
  const mode = async value => act(async () => { const select = document.querySelector('select'); select.value = value; select.dispatchEvent(new window.Event('change', { bubbles: true })); });
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.equal(input(), null, 'threshold fields do not crowd the card');
  await click(edit());
  assert.equal(input().value, '50');
  await setValue('101'); await click(save());
  assert.equal(writes.length, 0, 'invalid percentage is not written');
  await setValue('');
  assert.equal(save().disabled, true, 'blank input cannot be saved');
  await setValue('75.5');
  assert.equal(writes.length, 0, 'edits remain local until Save');
  await click(cancel());
  assert.equal(document.querySelector('[role="dialog"]'), null);
  await click(edit());
  assert.equal(input().value, '50', 'cancel discards the draft');
  await setValue('75.5'); await click(save());
  assert.deepEqual(writes.at(-1), ['/quiz-requirements/quiz/video', 'PATCH', { min_watch_percentage: 75.5, min_watch_seconds: null }]);
  assert.equal(document.querySelector('[role="dialog"]'), null);
  await click(edit()); await mode('seconds');
  assert.equal(writes.length, 1, 'changing type does not autosave a default');
  await setValue('30.5'); await click(save());
  assert.equal(writes.length, 1, 'seconds require integers');
  await setValue('121'); await click(save());
  assert.equal(writes.length, 1, 'seconds cannot exceed video duration');
  rejectSave = true;
  await setValue('30'); await click(save());
  assert.equal(input().value, '30');
  assert.equal(document.querySelector('[role="dialog"] [role="alert"]').textContent, 'Save failed');
  rejectSave = false;
  await click(save());
  assert.equal(rows[0].min_watch_seconds, 30);
  assert.equal(document.querySelector('[role="dialog"]'), null);
  const active = () => document.querySelector('.ruleActive input');
  assert.equal(active().checked, true, 'legacy rules default to active');
  rejectSave = true;
  await click(active());
  assert.equal(active().checked, true, 'failed activation writes keep the saved state');
  assert.equal(document.querySelector('[role="alert"]').textContent, 'Save failed');
  rejectSave = false;
  await click(active());
  assert.deepEqual(writes.at(-1), ['/quiz-requirements/quiz/video', 'PATCH', { is_active: false }]);
  assert.equal(active().checked, false);
  assert.equal(rows[0].min_watch_seconds, 30, 'activation preserves the threshold');
  await click(document.querySelector('.ruleChangeVideo'));
  assert.ok(document.querySelector('[role="dialog"]'));
  assert.equal(document.querySelector('[role="dialog"] input[type="number"]'), null, 'popup is only a video picker');
  await click(document.querySelector('[data-pick-video]'));
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.deepEqual(writes.slice(-2), [
    ['/quiz-requirements', 'POST', { quiz_id: 'quiz', video_id: 'replacement', position: 3, is_active: false, min_watch_percentage: null, min_watch_seconds: 30 }],
    ['/quiz-requirements/quiz/video', 'DELETE', undefined],
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].video_id, 'replacement');
  assert.equal(active().checked, false, 'replacement preserves inactive state');
  await click(active());
  assert.equal(active().checked, true, 'inactive rules can be reactivated');
  allowRemove = false;
  await click(document.querySelector('.danger'));
  assert.equal(rows.length, 1);
  allowRemove = true;
  await click(document.querySelector('.danger'));
  assert.equal(rows.length, 0);
  await click(document.querySelector('.partAdd'));
  await click(document.querySelector('[data-pick-video]'));
  assert.equal(rows[0].min_watch_percentage, 100, 'new rules start with the default threshold');
  await act(async () => root.render(React.createElement(Requirements, { ...props, editable: false })));
  assert.equal(document.querySelector('.ruleChangeVideo'), null);
  assert.equal(document.querySelector('.danger'), null);
  assert.equal(input(), null);
  assert.equal(document.querySelector('[aria-label^="quizEditRule:"]'), null);
  assert.equal(active().disabled, true);
  assert.equal(active().checked, true, 'new rules are active');
  assert.equal(document.querySelector('select'), null);
});
