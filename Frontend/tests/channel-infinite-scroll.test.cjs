const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { JSDOM } = require('jsdom');
const { QueryClient, QueryClientProvider } = require('@tanstack/react-query');
const { act } = React;

async function mount(t, tab) {
  const dom = new JSDOM('<div id="root"></div>', { url: `https://example.test/channel/author-a/${tab}` });
  const names = ['window', 'document', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT', 'IntersectionObserver'];
  const prior = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  const observers = new Set();
  globalThis.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; }
    observe() { observers.add(this); }
    disconnect() { observers.delete(this); }
  };
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const { createRoot } = require('react-dom/client');
  let channel = 'author-a', fail = false, repeat = false;
  const requests = [], cache = new Map();
  function response(kind, id, page, sortOrder) {
    requests.push({ kind, id, page, sortOrder });
    if (fail) throw new Error('Temporary error');
    const ids = page === 1 || repeat ? [1, 2] : [2, 3];
    return { [kind]: ids.map(i => ({ id: `${id}-${i}`, title: `${kind}-${id}-${i}`, blocks: [] })), pagination: { page, limit: 20, total: 40, totalPages: 2, hasNextPage: page < 2 } };
  }
  const mocks = {
    '~/authorization/authorization': { useAuthorization: () => ({ can: () => true, user: { id: 'viewer' } }) },
    '~/functions': { getToken: () => 'token' },
    '~/i18n': { useI18n: () => ({ t: key => key, locale: 'en' }) },
    '~/env': { env: {} },
    '~/constants': {},
    'react-router': { useParams: () => ({ id: channel }), useLocation: () => ({ pathname: `/channel/${channel}/${tab}` }), useNavigate: () => () => {}, Link: ({ to, ...props }) => React.createElement('a', { href: to, ...props }) },
    '../customSelect/customSelect': { default: ({ value, options, onChange }) => React.createElement('select', { value, onChange: e => onChange(e.target.value) }, options.map(option => React.createElement('option', { value: option.value, key: option.value }, option.label))) },
    '../library/ProfileTabs': { default: ({ children }) => React.createElement('div', { role: 'tablist' }, children) },
    '../shared/ExpandableDescription': { default: () => null },
    '../live/LiveList': { LiveList: () => null },
    '../itemSlider/item': { default: ({ props }) => React.createElement('article', null, props.title) },
    '../itemSlider/playlistItem': { default: ({ props }) => React.createElement('article', null, props.title) },
    './PostCard': { default: ({ post }) => React.createElement('article', null, post.title) },
    './api': { getChannelPosts: async (id, page, ascending) => response('posts', id, page, ascending ? 'asc' : 'desc'), getCollections: async ({ userId, page, sortOrder }) => response('collections', userId, page, sortOrder) },
    '~/API': { fetchFn: async ({ route }) => {
      const url = new URL(route, 'https://example.test');
      const parts = url.pathname.split('/');
      if (parts.length === 4) return { channel: { id: parts[3], full_name: 'Author' } };
      if (url.searchParams.get('limit') === '1') return { videos: [], pagination: { total: 40 } };
      return response(parts[4], parts[3], Number(url.searchParams.get('page')), url.searchParams.get('sortOrder'));
    } },
  };
  function load(file) {
    if (!path.extname(file)) file += fs.existsSync(file + '.ts') ? '.ts' : '.tsx';
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    new Function('require', 'module', 'exports', code)(name => {
      if (mocks[name]) return { __esModule: true, ...mocks[name] };
      if (name.endsWith('.webp')) return { __esModule: true, default: '/image.webp' };
      if (name.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
      if (name.startsWith('~/')) return load(path.resolve('app', name.slice(2)));
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name));
      return require(name);
    }, mod, mod.exports);
    return mod.exports;
  }
  const Component = load(path.resolve('app/components/channelPage/channelPage.tsx')).default;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const root = createRoot(document.getElementById('root'));
  const flush = () => act(() => new Promise(resolve => setTimeout(resolve, 30)));
  const render = async () => { await act(async () => root.render(React.createElement(QueryClientProvider, { client }, React.createElement(Component)))); await flush(); await flush(); };
  t.after(async () => { await act(async () => root.unmount()); client.clear(); dom.window.close(); for (const [name, descriptor] of prior) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  await render();
  return {
    requests, render, setFail: value => fail = value, setRepeat: value => repeat = value, setChannel: value => channel = value,
    rows: () => [...document.querySelectorAll('[role="tabpanel"]:not([hidden]) article, [role="tabpanel"]:not([hidden]) .collectionCards > a')].map(el => el.textContent),
    scroll: async () => { assert.equal(observers.size, 1); await act(async () => { for (const observer of [...observers]) { observer.callback([{ isIntersecting: true }]); observer.callback([{ isIntersecting: true }]); } }); await flush(); },
    sort: async value => { await act(async () => { const select = document.querySelector('select'); select.value = value; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }); await flush(); },
    retry: async () => { const button = [...document.querySelectorAll('button')].find(el => el.textContent === 'usersRetry'); assert.ok(button); await act(async () => button.click()); await flush(); },
  };
}
for (const tab of ['videos', 'playlists', 'collections', 'posts']) {
  test(`${tab}: channel infinite scroll appends unique items, retries failed pages, resets sorting and isolates authors`, async t => {
    const ui = await mount(t, tab);
    assert.equal(ui.rows().length, 2);
    assert.equal(document.querySelectorAll('select').length, 1, 'Only the shared channel sort control');
    ui.setFail(true); await ui.scroll();
    assert.equal(ui.rows().length, 2, 'Loaded cards remain after a page failure');
    assert.ok(document.querySelector('[role="alert"]'));
    ui.setFail(false); await ui.retry();
    assert.equal(ui.rows().length, 3, 'Overlapping page items are deduplicated');
    assert.equal(ui.requests.at(-1).page, 2);
    await ui.sort(tab === 'videos' || tab === 'playlists' ? 'created_at:asc' : 'asc');
    assert.equal(ui.rows().length, 2);
    assert.equal(ui.requests.at(-1).page, 1); assert.equal(ui.requests.at(-1).sortOrder, 'asc');
    ui.setChannel('author-b'); await ui.render();
    assert.equal(ui.rows().length, 2); assert.ok(ui.rows().every(row => row.includes('author-b')));
    assert.equal(ui.requests.at(-1).id, 'author-b'); assert.equal(ui.requests.at(-1).page, 1);
    ui.setRepeat(true); await ui.scroll();
    assert.equal(ui.rows().length, 2);
    assert.equal(document.querySelector('[role="tabpanel"]:not([hidden]) button'), null, 'Repeated final page stops loading');
  });
}
