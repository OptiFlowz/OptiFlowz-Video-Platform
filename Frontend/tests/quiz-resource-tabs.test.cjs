const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { JSDOM } = require('jsdom');

test('resource tabs keep their DOM, focus and scroll position while lists reset; header transfers remain usable', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://test.local/quizzes?tab=quizzes' });
  const names = ['window', 'document', 'HTMLElement', 'ResizeObserver', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    ResizeObserver: class { observe() {} disconnect() {} }, IS_REACT_ACT_ENVIRONMENT: true });
  const { act } = React, { createRoot } = require('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount()); dom.window.close();
    for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  const Router = React.createContext(null), cache = new Map();
  const noop = () => null;
  const styles = new Proxy({}, { get: (_, key) => String(key) });
  const mocks = {
    'react-router': { useSearchParams: () => [new URLSearchParams(React.useContext(Router).search)], useNavigate: () => React.useContext(Router).navigate },
    '@tanstack/react-query': { useQuery: () => ({ data: { items: [], pagination: { total: 0, totalPages: 1 } }, isFetching: false }) },
    '~/i18n': { useI18n: () => ({ t: key => key, locale: 'en' }) },
    '~/functions': { getToken: () => 'token' }, '~/constants': {},
    '~/components/myVideosPage/sidebar/sidebar': { __esModule: true, default: noop },
    '~/components/library/pagination': { __esModule: true, default: noop },
    '~/components/library/librarySortButton': { __esModule: true, default: ({ label }) => React.createElement('button', null, label) },
    '~/components/confirmPopup/confirmDialog': { ConfirmDialog: noop },
    '~/components/confirmPopup/useConfirm': { useConfirm: () => ({ confirm: async () => true, dialogProps: {} }) },
    './shared': { styles, useAccess: () => ({ user: { id: 'me' }, read: true, create: true, can: permission => !permission.endsWith('read_any'), canOwn: () => true }),
      useAll: () => ({ data: [] }), useAction: () => ({ busy: false }), Notice: noop, LoadState: noop, Select: noop },
    './api': { engineKey: ['quiz-engine'] },
    './QuestionTransfer': { __esModule: true, default: ({ mode, onClose }) => React.createElement('button', { 'data-transfer': mode, onClick: onClose }, 'Close transfer') },
    './QuestionEditor': { __esModule: true, default: noop }, './CategoryEditor': { __esModule: true, default: noop },
    './CertificateTemplates': { __esModule: true, default: ({ id, onEdit }) => React.createElement('section', { 'data-certificate-library': true }, id ? 'Modern' : React.createElement('button', { onClick: () => onEdit('modern') }, 'Open template')) },
    './QuizEditor': { __esModule: true, default: noop }, './QuizStatus': { __esModule: true, default: noop },
    './EditorPopup': { __esModule: true, default: noop, EditorBusyContext: React.createContext(null), EditorBusyStatusContext: React.createContext(false) },
  };
  function load(file) {
    file = path.resolve(file);
    if (!path.extname(file)) file += fs.existsSync(file + '.ts') ? '.ts' : '.tsx';
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    new Function('require', 'module', 'exports', code)(name => name in mocks ? mocks[name] : name.endsWith('.css') ? {} : name.startsWith('~/') ? load('app/' + name.slice(2)) : name.startsWith('.') ? load(path.join(path.dirname(file), name)) : require(name), mod, mod.exports);
    return mod.exports;
  }
  const Page = load('app/components/quizEngine/QuizzesPage.tsx').default;
  function App() {
    const [search, setSearch] = React.useState('tab=quizzes');
    return React.createElement(Router.Provider, { value: { search, navigate: url => setSearch(url.split('?')[1]) } }, React.createElement(Page));
  }
  await act(async () => root.render(React.createElement(App)));
  const tabs = [...document.querySelectorAll('[role="tab"]')], strip = document.querySelector('[role="tablist"]');
  strip.scrollLeft = 40;
  for (const index of [1, 2, 3, 0]) {
    await act(async () => { tabs[index].focus(); tabs[index].click(); });
    assert.equal(document.querySelector('[role="tablist"]'), strip);
    assert.equal(document.activeElement, tabs[index]);
    assert.equal(strip.scrollLeft, 40);
    assert.equal(tabs[index].getAttribute('aria-selected'), 'true');
    assert.equal(document.querySelector('h1').textContent, tabs[index].textContent);
  }
  await act(async () => tabs[3].click());
  await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === 'Open template').click());
  assert.equal(document.querySelector('[role="tablist"]'), null, 'template detail replaces the main tabulation');
  const breadcrumb = document.querySelector('.editorBreadcrumb');
  assert.match(breadcrumb.textContent, /navQuizzes.*quizCertificateLibrary.*quizCertificateEdit/);
  await act(async () => breadcrumb.querySelectorAll('button')[1].click());
  assert.ok(document.querySelector('[role="tablist"]'), 'breadcrumb returns to template library');
  await act(async () => document.querySelectorAll('[role="tab"]')[1].click());
  const search = document.querySelector('input[type="search"]');
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(search, 'test');
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  await act(async () => document.querySelectorAll('[role="tab"]')[2].click());
  assert.equal(document.querySelector('input[type="search"]').value, '', 'resource filters reset independently of persistent tabs');
  await act(async () => document.querySelectorAll('[role="tab"]')[1].click());
  for (const mode of ['import', 'export']) {
    await act(async () => document.querySelectorAll('.headerActions button')[mode === 'import' ? 0 : 1].click());
    assert.equal(document.querySelector('[data-transfer]').dataset.transfer, mode);
    await act(async () => document.querySelector('[data-transfer]').click());
    assert.equal(document.querySelector('[data-transfer]'), null);
  }
});
