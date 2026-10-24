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
  let waitForConfirmation = false, resolveConfirmation, actionRuns = 0;
  let rows = [{ quiz_id: 'quiz', video_id: 'video', position: 3, min_watch_percentage: 50, min_watch_seconds: null, video_card: { id: 'video', title: 'Video', duration_seconds: 120 } }];
  const styles = new Proxy({}, { get: (_, key) => String(key) });
  const mocks = {
    '~/functions': { formatDuration: seconds => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` },
    '~/i18n': { useI18n: () => ({ t: (key, params) => key === 'quizWatchTimeExceedsVideo' ? `Watch time cannot exceed ${params.duration}` : key }) }, '~/constants': { AddSVG: '+', DeleteSVG: 'delete' },
    '~/components/editPlaylistPage/PlaylistVideoPicker': { __esModule: true, default: ({ onAdd, busy, included }) => React.createElement(React.Fragment, null, ...['replacement', 'another'].map(id => React.createElement('button', { key: id, 'data-pick-video': id, disabled: busy || included.includes(id), onClick: () => onAdd({ id, title: id, duration_seconds: 120 }) }, 'Pick video'))) },
    '~/components/confirmPopup/confirmDialog': { ConfirmDialog: () => null },
    '~/components/confirmPopup/useConfirm': { useConfirm: () => ({ confirm: async () => waitForConfirmation ? new Promise(resolve => { resolveConfirmation = resolve; }) : allowRemove, dialogProps: {} }) },
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
        return { busy, error, run: async work => { actionRuns++; setBusy(true); setError(''); try { await work(); } catch (error) { setError(error.message); } finally { setBusy(false); } } };
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
  const segments = () => [...document.querySelectorAll('input[role="spinbutton"]')];
  const setSegment = async (index, value) => act(async () => {
    const field = segments()[index];
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(field, value);
    field.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
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
  assert.equal(input(), null, 'watch time uses the shared duration control');
  assert.deepEqual(segments().map(field => field.value), ['00', '00', '00']);
  assert.equal(document.querySelector('[role="dialog"] [role="alert"]'), null, 'the untouched zero default shows no warning');
  assert.ok(segments().every(field => !field.hasAttribute('aria-invalid')));
  let invalidEvent;
  segments()[2].addEventListener('invalid', event => { invalidEvent = event; });
  await click(save());
  assert.equal(writes.length, 1, 'the zero default must be filled before saving');
  assert.equal(document.querySelector('[role="dialog"] [role="alert"]').textContent, 'quizWatchTimeRequired', 'trying to save reveals the warning');
  assert.equal(invalidEvent.defaultPrevented, true, 'saving must not open a native validation popup');
  assert.equal(document.activeElement, segments()[2], 'saving an invalid time focuses the seconds input');
  await mode('percentage'); await mode('seconds');
  assert.equal(document.querySelector('[role="dialog"] [role="alert"]'), null, 'switching back starts with a pristine time field');
  await setSegment(2, '0');
  assert.equal(document.querySelector('[role="dialog"] [role="alert"]').textContent, 'quizWatchTimeRequired', 'editing an invalid time reveals its warning');
  await setSegment(2, '30.5');
  assert.equal(segments()[2].value, '0', 'fractional seconds cannot be entered');
  await setSegment(2, '1');
  assert.equal(document.querySelector('[role="dialog"] [role="alert"]'), null, 'the warning clears while entering a valid time');
  await setSegment(1, '2');
  assert.equal(document.querySelector('[role="dialog"] [role="alert"]').textContent, 'Watch time cannot exceed 2:00');
  let valid;
  await act(async () => { valid = segments()[2].checkValidity(); });
  assert.equal(valid, false);
  await click(save());
  assert.equal(writes.length, 1, 'seconds cannot exceed video duration');
  assert.equal(document.activeElement, segments()[2], 'an excessive watch time also focuses seconds');
  await setSegment(2, '0');
  assert.equal(segments()[2].checkValidity(), true, 'exactly the video duration is valid');
  await setSegment(0, '1'); await click(save());
  assert.equal(writes.length, 1, 'hours are included in the maximum validation');
  await setSegment(0, '0'); await setSegment(1, '0'); await click(save());
  assert.equal(writes.length, 1, 'zero watch time is not saved');
  assert.equal(document.querySelector('[role="dialog"] [role="alert"]').textContent, 'quizWatchTimeRequired');
  rejectSave = true;
  await setSegment(2, '30'); await click(save());
  assert.equal(segments()[2].value, '30');
  assert.equal(document.querySelector('[role="dialog"] [role="alert"]').textContent, 'Save failed');
  rejectSave = false;
  await click(save());
  assert.equal(rows[0].min_watch_seconds, 30);
  assert.equal(document.querySelector('[role="dialog"]'), null);
  await click(edit());
  assert.deepEqual(segments().map(field => field.value), ['00', '00', '30'], 'saved seconds round-trip into the duration control');
  await click(cancel());
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
  const beforeDelete = actionRuns;
  await click(document.querySelector('.danger'));
  assert.equal(rows.length, 1);
  assert.equal(actionRuns, beforeDelete, 'cancelling must not start a loading action');
  waitForConfirmation = true;
  const beforeDeleteWrites = writes.length;
  await click(document.querySelector('.danger'));
  assert.equal(actionRuns, beforeDelete, 'waiting for confirmation must not show a saving toast');
  assert.equal(writes.length, beforeDeleteWrites);
  await act(async () => resolveConfirmation(false));
  assert.equal(actionRuns, beforeDelete, 'a delayed cancellation never starts the action');
  await click(document.querySelector('.danger'));
  assert.equal(actionRuns, beforeDelete);
  await act(async () => resolveConfirmation(true));
  assert.equal(actionRuns, beforeDelete + 1, 'loading starts after confirmation is accepted');
  assert.equal(rows.length, 0);
  waitForConfirmation = false; allowRemove = true;
  await click(document.querySelector('.partAdd'));
  await click(document.querySelector('[data-pick-video]'));
  assert.equal(rows[0].min_watch_percentage, 100, 'new rules start with the default threshold');
  assert.ok(document.querySelector('[role="dialog"]'), 'adding a rule keeps the picker open');
  assert.equal(document.querySelector('[data-pick-video="replacement"]').disabled, true, 'added videos cannot be added twice');
  await click(document.querySelector('[data-pick-video="another"]'));
  assert.deepEqual(rows.map(row => row.video_id), ['replacement', 'another'], 'another video can be added without reopening');
  assert.equal(rows[1].position, rows[0].position + 1);
  assert.ok(document.querySelector('[role="dialog"]'));
  await click(document.querySelector('[role="dialog"] .cancelBtn'));
  assert.equal(document.querySelector('[role="dialog"]'), null, 'Back still closes the picker');
  await act(async () => root.render(React.createElement(Requirements, { ...props, editable: false })));
  assert.equal(document.querySelector('.ruleChangeVideo'), null);
  assert.equal(document.querySelector('.danger'), null);
  assert.equal(input(), null);
  assert.equal(document.querySelector('[aria-label^="quizEditRule:"]'), null);
  assert.equal(active().disabled, true);
  assert.equal(active().checked, true, 'new rules are active');
  assert.equal(document.querySelector('select'), null);
});
