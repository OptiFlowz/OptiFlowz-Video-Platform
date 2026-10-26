const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { JSDOM } = require('jsdom');
const { QueryClient, QueryClientProvider } = require('@tanstack/react-query');
const en = require('../app/locales/en.json');
const { act } = React;
const translate = (key, params = {}) => String(en[key] ?? key).replace(/\{\{param\.(\w+)\}\}/g, (_, key) => params[key] ?? '');

async function mount(t, { userId = 'author-a', sortOrder = 'desc', allowed = true, token = 'token', fail = false, empty = false } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.test/channel/author-a/quizzes' });
  const names = ['window', 'document', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT', 'IntersectionObserver'];
  const prior = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  const observers = new Set();
  globalThis.IntersectionObserver = class { constructor(callback) { this.callback = callback; } observe() { observers.add(this); } disconnect() { observers.delete(this); } };
  const { createRoot } = require('react-dom/client');
  const requests = [], cache = new Map();
  const styles = new Proxy({}, { get: (_, key) => key });
  const mocks = {
    '~/authorization/authorization': { useAuthorization: () => ({ user: { id: 'viewer' }, can: permission => allowed && permission === 'quizzes.participate' }) },
    '~/functions': { getToken: () => token },
    '~/i18n': { useI18n: () => ({ t: translate, locale: 'en' }) },
    '~/constants': { ArrowSVG: '→', CheckSVG: '✓', QuizSVG: 'Q', SearchSVG: '⌕' },
    'react-router': { Link: ({ to, ...props }) => React.createElement('a', { href: to, ...props }) },
    '~/components/customSelect/customSelect': { default: ({ value, options, onChange, ariaLabel, disabled }) => React.createElement('select', { value, disabled, 'aria-label': ariaLabel, onChange: e => onChange(e.target.value) }, options.map(o => React.createElement('option', { key: o.value, value: o.value }, o.label))) },
    '~/API': { fetchFn: async request => {
      requests.push(request);
      assert.equal(request.options.headers.Authorization, `Bearer ${token}`);
      assert.equal(request.options.cache, 'no-store');
      assert.ok(request.options.signal instanceof AbortSignal);
      assert.ok(request.route.startsWith('api/quizzes/published?'));
      if (fail) throw new Error('Unavailable');
      const params = new URL(request.route, 'https://example.test').searchParams;
      const page = Number(params.get('page')), limit = Number(params.get('limit'));
      return { quizzes: empty ? [] : [{ id: `published-quiz-${page}`, title: `Quiz ${page} &amp; learning`, description: '<script>safe text</script>', question_count: 10, time_limit_seconds: 30, passing_score_percentage: 80, has_certificate: true }], pagination: { page, limit, total: empty ? 0 : 25, totalPages: empty ? 0 : Math.ceil(25 / limit) } };
    } },
  };
  function load(file) {
    if (!path.extname(file)) file += fs.existsSync(file + '.ts') ? '.ts' : fs.existsSync(file + '.tsx') ? '.tsx' : '.mjs';
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    new Function('require', 'module', 'exports', code)(name => mocks[name] ? { __esModule: true, ...mocks[name] } : name.endsWith('.css') ? { __esModule: true, default: styles } : name.startsWith('~/') ? load(path.resolve('app', name.slice(2))) : name.startsWith('.') ? load(path.resolve(path.dirname(file), name)) : require(name), mod, mod.exports);
    return mod.exports;
  }
  const View = load(path.resolve('app/components/quizEngine/PublishedQuizList.tsx')).default;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const root = createRoot(document.getElementById('root'));
  const flush = () => act(() => new Promise(resolve => setTimeout(resolve, 30)));
  t.after(async () => { await act(async () => root.unmount()); client.clear(); dom.window.close(); for (const [name, descriptor] of prior) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  const render = async () => { await act(async () => root.render(React.createElement(QueryClientProvider, { client }, React.createElement(View, { key: userId, userId, sortOrder })))); await flush(); };
  await render();
  return { requests, flush, render, setFail: value => fail = value, setUser: value => userId = value, setAllowed: value => allowed = value,
    click: async label => { const button = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === label || b.textContent === label); assert.ok(button, label); assert.equal(button.disabled, false); await act(async () => button.click()); await flush(); },
    setSort: value => sortOrder = value,
    scroll: async () => { await act(async () => { for (const observer of [...observers]) observer.callback([{ isIntersecting: true }]); }); await flush(); },
  };
}

test('channel quizzes use participant API, safe text, exact durations and infinite scroll without a filter bar', async t => {
  const ui = await mount(t);
  assert.equal(document.querySelector('h3').textContent, 'Quiz 1 & learning');
  assert.match(document.body.textContent, /30 seconds/);
  assert.match(document.body.textContent, /Certificate available/);
  assert.equal(document.querySelector('script'), null);
  assert.equal(document.querySelector('input, select'), null);
  const cardLink = document.querySelector('article > a');
  assert.equal(cardLink.getAttribute('href'), '/quiz/published-quiz-1');
  assert.equal(cardLink.getAttribute('aria-labelledby'), document.querySelector('h3').id);
  assert.ok(cardLink.contains(document.querySelector('.facts')));
  assert.equal(document.querySelectorAll('article a').length, 1, 'The whole card is one keyboard-accessible link');
  assert.equal(cardLink.querySelector('a, button'), null, 'No nested interactive elements');
  assert.equal(new URL(ui.requests[0].route, 'https://example.test').searchParams.get('user_id'), 'author-a');
  await ui.scroll();
  assert.deepEqual([...document.querySelectorAll('h3')].map(el => el.textContent), ['Quiz 1 & learning', 'Quiz 2 & learning']);
  const count = ui.requests.length;
  await ui.scroll(); assert.equal(ui.requests.length, count, 'Stops at the last page');
  ui.setSort('asc'); await ui.render();
  const params = new URL(ui.requests.at(-1).route, 'https://example.test').searchParams;
  assert.equal(params.get('sortOrder'), 'asc'); assert.equal(params.get('sortBy'), 'created_at');
  assert.equal(params.get('page'), '1'); assert.equal(document.querySelectorAll('h3').length, 1);
});

test('channel catalog keeps loaded quizzes when the next request fails and retries that page', async t => {
  const ui = await mount(t);
  ui.setFail(true); await ui.scroll();
  assert.equal(document.querySelectorAll('h3').length, 1);
  assert.ok(document.querySelector('[role="alert"]'));
  const count = ui.requests.length; await ui.scroll(); assert.equal(ui.requests.length, count);
  ui.setFail(false); await ui.click(translate('usersRetry'));
  assert.equal(document.querySelectorAll('h3').length, 2);
  assert.equal(new URL(ui.requests.at(-1).route, 'https://example.test').searchParams.get('page'), '2');
});

test('channel catalog filters server-side and does not reuse another author’s pages', async t => {
  const ui = await mount(t, { userId: 'author-a' });
  await ui.scroll();
  ui.setUser('author-b'); await ui.render();
  const params = new URL(ui.requests.at(-1).route, 'https://example.test').searchParams;
  assert.equal(params.get('user_id'), 'author-b'); assert.equal(params.get('page'), '1');
  assert.equal(document.querySelectorAll('h3').length, 1);
});

test('catalog handles failures, retry, empty results and revoking permission', async t => {
  const ui = await mount(t, { fail: true, empty: true });
  assert.match(document.querySelector('[role="alert"]').textContent, /Failed to load/);
  ui.setFail(false); await ui.click(translate('usersRetry'));
  assert.match(document.body.textContent, /No quizzes found/);
  const count = ui.requests.length; ui.setAllowed(false); await ui.render();
  assert.equal(document.getElementById('root').textContent, ''); assert.equal(ui.requests.length, count);
});
for (const options of [{ allowed: false }, { token: '' }]) test(`catalog never requests data without access: ${JSON.stringify(options)}`, async t => {
  const ui = await mount(t, options); assert.equal(ui.requests.length, 0); assert.equal(document.getElementById('root').textContent, '');
});
