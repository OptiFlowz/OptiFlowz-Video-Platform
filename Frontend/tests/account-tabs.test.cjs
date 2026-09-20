const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { JSDOM } = require('jsdom');

function loadAccount(mocks) {
  const cache = new Map();
  function load(file) {
    if (!path.extname(file)) file += fs.existsSync(`${file}.ts`) ? '.ts' : '.tsx';
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} };
    cache.set(file, mod);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    new Function('require', 'module', 'exports', code)(name => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.endsWith('.css')) return {};
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name));
      return require(name);
    }, mod, mod.exports);
    return mod.exports;
  }
  return load(path.resolve(__dirname, '../app/components/accountPage/accountPage.tsx')).default;
}

test('account tabs default to history, preload permitted content, follow tab URLs, append infinite results, retry failed pages and honor permissions', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.test/account' });
  const names = ['window', 'document', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT', 'IntersectionObserver', 'ResizeObserver'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  const { act } = React;
  const { createRoot } = require('react-dom/client');
  const { QueryClient, QueryClientProvider } = require('@tanstack/react-query');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const requests = [];
  const observers = new Set();
  globalThis.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; }
    observe() { observers.add(this); }
    disconnect() { observers.delete(this); }
  };
  let failSavedPage = true;
  let allowCertificates = true;
  const locationListeners = new Set();
  const subscribe = listener => { locationListeners.add(listener); return () => locationListeners.delete(listener); };
  const changeLocation = (url, options) => {
    assert.equal(options.preventScrollReset, true);
    dom.window.history.pushState(null, '', url);
    locationListeners.forEach(listener => listener());
  };
  const Account = loadAccount({
    'react-router': {
      useLocation: () => ({ pathname: React.useSyncExternalStore(subscribe, () => dom.window.location.pathname) }),
      useNavigate: () => changeLocation,
    },
    '~/env': { env: {} },
    '~/hooks/useLocalizedPageTitle': { useLocalizedPageTitle() {} },
    '~/authorization/authorization': { useAuthorization: () => ({ can: permission => permission !== 'certificates' || allowCertificates }) },
    '~/authorization/permissions': { P: { videosLibrary: 'videos', playlistsLibrary: 'playlists', quizzesCertificates: 'certificates' } },
    '~/constants': { EditSVG: null, LogOutSVG: null, SettingsSVG: null },
    '~/auth/session': { redirectToLogin() {} },
    '~/functions': { getToken: () => 'token', formatDate: value => value },
    '~/i18n': { useI18n: () => ({ t: key => key }) },
    '~/API': { fetchFn: async request => {
      requests.push(request);
      if (request.route === 'api/quizzes/certificates') return { success: true, certificates: [] };
      const saved = request.route.includes('playlists');
      const params = new URL(request.route, 'https://example.test/').searchParams;
      const laterPage = saved ? Number(params.get('offset')) > 0 : Number(params.get('page')) > 1;
      if (saved && laterPage && failSavedPage) { failSavedPage = false; throw new Error('Try again'); }
      const items = laterPage ? [{ id: '19' }, { id: '20' }, { id: '21' }]
        : Array.from({ length: 20 }, (_, i) => ({ id: String(i) }));
      return saved ? { playlists: items } : { videos: items };
    } },
    './accountInfo': { __esModule: true, default: () => null },
    './editAccountPopup': { __esModule: true, default: () => null },
    './settingsPopup': { __esModule: true, default: () => null },
    '../../../assets/LoginBackground.webp': '/background.webp',
    '../itemSlider/item': { __esModule: true, default: ({ props }) => React.createElement('article', null, props.id) },
    '../itemSlider/playlistItem': { __esModule: true, default: ({ props }) => React.createElement('article', null, props.id) },

  });
  const root = createRoot(document.getElementById('root'));
  const render = () => root.render(React.createElement(QueryClientProvider, { client }, React.createElement(Account)));
  const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  const click = async element => { await act(async () => element.click()); await flush(); };
  const intersect = async () => {
    assert.ok(observers.size, 'An infinite-scroll sentinel must be observed');
    await act(async () => { for (const observer of [...observers]) observer.callback([{ isIntersecting: true }]); });
    await flush();
  };
  const tabs = () => [...document.querySelectorAll('[role="tab"]')];
  const activePanel = () => document.querySelector('[role="tabpanel"]:not([hidden])');
  try {
    await act(async () => render()); await flush();
    assert.deepEqual(tabs().map(tab => tab.textContent), ['watchHistory', 'likedVideos', 'continueWatching', 'savedPlaylists', 'accountCertificatesTitle']);
    assert.equal(tabs()[0].getAttribute('aria-selected'), 'true');
    assert.equal(requests.length, 5, 'Prefetch all permitted tabs, deduplicating the active query');
    assert.deepEqual(requests.map(request => request.route).sort(), [
      'api/videos/user/history?limit=20&page=1', 'api/videos/user/liked?limit=20&page=1',
      'api/videos/user/continue?limit=20&page=1', 'api/playlists/user/saved?limit=20&offset=0',
      'api/quizzes/certificates',
    ].sort());
    assert.equal(requests[0].route, 'api/videos/user/history?limit=20&page=1');
    assert.equal(requests[0].options.headers.Authorization, 'Bearer token');
    assert.equal(activePanel().querySelectorAll('article').length, 20);
    await intersect();
    assert.equal(requests.at(-1).route, 'api/videos/user/history?limit=20&page=2');
    assert.equal(activePanel().querySelectorAll('article').length, 22, 'Append new results and deduplicate overlaps');
    assert.equal(observers.size, 0, 'Stop when the last page is shorter than the requested limit');
    await click(tabs()[1]);
    assert.equal(dom.window.location.pathname, '/account/liked');
    assert.equal(requests.length, 6, 'Switching to a prefetched tab must not refetch');
    assert.equal(activePanel().querySelector('[aria-busy="true"]'), null);
    assert.equal(activePanel().querySelectorAll('article').length, 20);
    await act(async () => tabs()[1].dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    await flush();
    assert.equal(document.activeElement, tabs()[2]);
    assert.equal(dom.window.location.pathname, '/account/continue');
    assert.equal(requests.length, 6);
    await click(tabs()[3]);
    assert.equal(dom.window.location.pathname, '/account/playlists');
    assert.equal(requests.length, 6);
    await intersect();
    assert.equal(requests.at(-1).route, 'api/playlists/user/saved?limit=20&offset=20');
    assert.equal(activePanel().querySelectorAll('article').length, 20, 'Keep loaded cards when the next request fails');
    assert.ok(activePanel().querySelector('[role="alert"]'));
    await click([...activePanel().querySelectorAll('button')].find(button => button.textContent === 'usersRetry'));
    assert.equal(requests.at(-1).route, 'api/playlists/user/saved?limit=20&offset=20');
    assert.equal(activePanel().querySelectorAll('article').length, 22);
    assert.equal(observers.size, 0);
    await click(tabs()[0]);
    assert.equal(dom.window.location.pathname, '/account');
    assert.equal(activePanel().querySelectorAll('article').length, 22, 'Reopening a tab retains loaded pages');
    const requestCount = requests.length;
    await click(tabs()[4]);
    assert.equal(dom.window.location.pathname, '/account/certificates');
    assert.equal(activePanel().textContent, 'accountCertificatesEmpty');
    assert.equal(activePanel().querySelector('.skeletonCertificateCard'), null);
    // Direct URL entry and browser history updates select the matching tab.
    await act(async () => { changeLocation('/account/liked', { preventScrollReset: true }); });
    assert.equal(tabs()[1].getAttribute('aria-selected'), 'true');
    await act(async () => {
      dom.window.history.replaceState(null, '', '/account/certificates');
      dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
      locationListeners.forEach(listener => listener());
    });
    assert.equal(tabs()[4].getAttribute('aria-selected'), 'true');
    assert.equal(requests.length, requestCount);
    allowCertificates = false;
    await act(async () => render()); await flush();
    assert.equal(tabs().length, 4);
    assert.equal(tabs()[0].getAttribute('aria-selected'), 'true');
    assert.notEqual(activePanel().textContent, 'accountCertificatesEmpty');
    client.clear();
    await act(async () => root.render(null));
    requests.length = 0;
    await act(async () => render()); await flush();
    assert.equal(requests.length, 4);
    assert.ok(requests.every(request => request.route !== 'api/quizzes/certificates'), 'Never prefetch a tab without permission');
  } finally {
    await act(async () => root.unmount());
    client.clear(); dom.window.close();
    for (const name of names) { const descriptor = previous.get(name); if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  }
});
