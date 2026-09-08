const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { JSDOM } = require('jsdom');
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const { useQuery, useQueryClient, QueryClient, QueryClientProvider } = require('@tanstack/react-query');
const project = path.resolve(__dirname, '..');

// Exercise the actual TS/TSX modules using Node's test runner and a local DOM.
function modules(mocks = {}) {
  const cache = new Map();
  function load(file) {
    file = path.resolve(project, file);
    if (!path.extname(file)) file += fs.existsSync(`${file}.ts`) ? '.ts' : '.tsx';
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    const localRequire = name => {
      if (Object.hasOwn(mocks, name)) return { __esModule: true, ...mocks[name] };
      if (name.endsWith('.css') || /\.(webp|png)$/.test(name)) return {};
      if (name.startsWith('~/')) return load(path.join(project, 'app', name.slice(2)));
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name));
      return require(name);
    };
    new Function('require', 'module', 'exports', code)(localRequire, mod, mod.exports);
    return mod.exports;
  }
  return load;
}

function dom(t) {
  require("@tanstack/react-query").onlineManager.setOnline(true);
  const instance = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://app.example/' });
  const descriptors = new Map();
  const globals = ['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'Event', 'CustomEvent', 'StorageEvent', 'HTMLElement', 'Element', 'HTMLAnchorElement', 'customElements'];
  for (const key of globals) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value: instance.window[key], writable: true, configurable: true });
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  t.after(async () => {
    const mountedRoot = instance.window.document.getElementById("root")?.mountedRoot;
    if (mountedRoot) await act(async () => mountedRoot.unmount());
    instance.window.close();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
  return document.getElementById('root');
}
const session = token => ({ token, user: { id: token, full_name: token, email: `${token}@example.invalid`, image_url: '', roles: [] } });
const waitForUpdates = () => act(() => new Promise(resolve => setTimeout(resolve, 25)));
const identity = ({ children }) => children;
const i18n = { useI18n: () => ({ t: (key, params) => `${key}${params ? JSON.stringify(params) : ''}` }), I18nProvider: identity };

test('redirects retain internal paths and reject executable, external and normalized protocol-relative URLs', () => {
  const { safeRedirect } = modules()('app/auth/safeRedirect.ts');
  for (const value of ['javascript:alert(1)', 'https://evil.example', '//evil.example', '/\\evil.example', '/%2fexample', '/a/..//evil.example', '/%0a/evil', '/a/../%2fexample', '/%zz']) {
    assert.equal(safeRedirect(value), '/', value);
  }
  assert.equal(safeRedirect('/playlist/123?next=%2Fvideo%2F456#description'), '/playlist/123?next=%2Fvideo%2F456#description');
  assert.equal(safeRedirect('/search/a%20b'), '/search/a%20b');
});

test('session-only login supports profile updates and never creates a remembered session', t => {
  dom(t);
  const auth = modules()('app/auth/session.ts');
  auth.saveSession(session('A'), false);
  // Storage formatting must not determine which storage gets the update.
  sessionStorage.setItem('user', JSON.stringify(session('A'), null, 2));
  auth.updateStoredProfile({ ...session('A').user, image_url: '/new-image' }, 'A');
  assert.equal(auth.getStoredUser().user.image_url, '/new-image');
  assert.equal(localStorage.getItem('user'), null);
  auth.saveSession(session('B'), true);
  auth.updateStoredProfile(session('A').user, 'A');
  assert.equal(auth.getToken(), 'B');
  assert.equal(auth.getStoredUser().user.id, 'B');
  assert.equal(sessionStorage.getItem('user'), null);
});

test('session changes notify consumers and logout preserves language and privacy choices', t => {
  dom(t);
  const auth = modules()('app/auth/session.ts');
  localStorage.setItem('platformLanguage', 'sr');
  localStorage.setItem('privacyPreferences', 'kept');
  let notifications = 0;
  const unsubscribe = auth.subscribeToSession(() => notifications++);
  auth.saveSession(session('A'), true);
  auth.clearSession();
  window.dispatchEvent(new StorageEvent('storage', { key: 'user' }));
  assert.equal(notifications, 3);
  assert.equal(auth.getToken(), null);
  assert.equal(localStorage.getItem('platformLanguage'), 'sr');
  assert.equal(localStorage.getItem('privacyPreferences'), 'kept');
  unsubscribe();
});

test('invalid stored data cannot impersonate a session or hide a valid remembered session', t => {
  dom(t);
  const auth = modules()('app/auth/session.ts');
  sessionStorage.setItem('user', 'broken');
  localStorage.setItem('user', JSON.stringify(session('A')));
  assert.equal(auth.getToken(), 'A');
  localStorage.setItem('user', JSON.stringify({ user: { id: 'A' } }));
  assert.equal(auth.getStoredUser(), null);
});

test('OAuth requires a matching, fresh, single-use browser transaction and preserves return path', t => {
  dom(t);
  const oauth = modules()('app/auth/googleOAuth.ts');
  assert.equal(oauth.consumeGoogleAttempt('/login'), null);
  const first = oauth.startGoogleAttempt('/video/123?t=42', false);
  assert.match(first, /^[a-f\d]{64}$/);
  assert.equal(oauth.consumeGoogleAttempt('wrong'), null);
  const valid = oauth.consumeGoogleAttempt(first);
  assert.equal(valid.redirect, '/video/123?t=42');
  assert.equal(valid.remember, false);
  assert.equal(oauth.consumeGoogleAttempt(first), null);
  const second = oauth.startGoogleAttempt('//evil.example', true);
  assert.notEqual(second, first);
  assert.equal(oauth.consumeGoogleAttempt(second).redirect, '/');
  const expired = oauth.startGoogleAttempt('/', true);
  const record = JSON.parse(sessionStorage.getItem('optiflowz-google-attempt'));
  record.createdAt -= 11 * 60 * 1000;
  sessionStorage.setItem('optiflowz-google-attempt', JSON.stringify(record));
  assert.equal(oauth.consumeGoogleAttempt(expired), null);
});

test('HTTP 503 is unhealthy; successful health and aborted requests are handled', async t => {
  dom(t);
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const { checkServerReachability } = modules({ './env': { env: { apiBaseUrl: 'https://api.example' } } })('app/serverReachability.ts');
  globalThis.fetch = async () => new Response('', { status: 503 });
  assert.equal(await checkServerReachability(), false);
  globalThis.fetch = async () => new Response('{}', { status: 200 });
  assert.equal(await checkServerReachability(), true);
  globalThis.fetch = async (_url, { signal }) => { signal.throwIfAborted(); throw new Error('offline'); };
  const controller = new AbortController(); controller.abort();
  assert.equal(await checkServerReachability(controller.signal), false);
  assert.equal(await checkServerReachability(), false);
});

test('late 401 from a previous login and unauthenticated 401 cannot clear the current session', async t => {
  dom(t);
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => new Response('not-json', { status: 401 });
  const load = modules({ './env': { env: { apiBaseUrl: 'https://api.example' } } });
  const auth = load('app/auth/session.ts');
  const { fetchFn } = load('app/API.ts');
  auth.saveSession(session('B'), false);
  await assert.rejects(fetchFn({ route: 'api/private', options: { headers: { Authorization: 'Bearer A' } } }), error => error.status === 401);
  assert.equal(auth.getToken(), 'B');
  await assert.rejects(fetchFn({ route: 'api/public', options: {} }), error => error.status === 401);
  assert.equal(auth.getToken(), 'B');
  window.history.replaceState(null, '', '/login');
  await assert.rejects(fetchFn({ route: 'api/private', options: { headers: { Authorization: 'Bearer B' } } }), error => error.status === 401);
  assert.equal(auth.getToken(), null);
});

test('switching accounts replaces legacy caches, aborts in-flight work and resets component state', async t => {
  const container = dom(t);
  const load = modules();
  const auth = load('app/auth/session.ts');
  const Boundary = load('app/auth/sessionBoundary.tsx').default;
  const clients = new Map();
  const cancelled = new Set();
  let mountCount = 0;
  function Consumer() {
    const token = auth.getToken();
    const client = useQueryClient(); clients.set(token, client);
    const [mount] = React.useState(() => ++mountCount);
    const result = useQuery({ queryKey: ['legacy-private-list'], queryFn: async () => token, refetchOnMount: false, staleTime: Infinity });
    useQuery({ queryKey: ['in-flight'], queryFn: ({ signal }) => new Promise(() => signal.addEventListener('abort', () => cancelled.add(token))) });
    return React.createElement('p', { 'data-mount': mount }, result.data ?? 'loading');
  }
  auth.saveSession(session('A'), true);
  const root = createRoot(container);
  container.mountedRoot = root;
  await act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(Boundary, null, React.createElement(Consumer)))));
  await waitForUpdates();
  assert.equal(container.textContent, 'A');
  const firstNode = container.querySelector('p');
  await act(async () => { auth.clearSession(); auth.saveSession(session('B'), false); });
  await waitForUpdates();
  assert.equal(container.textContent, 'B');
  assert.notEqual(container.querySelector('p'), firstNode);
  assert.notEqual(clients.get('A'), clients.get('B'));
  assert.equal(clients.get('A').getQueryCache().getAll().length, 0);
  assert.ok(cancelled.has('A'));
});

test('connection failures and retry keep the active form mounted with its draft', async t => {
  const container = dom(t);
  let healthy = true;
  const load = modules({
    '~/authorization/authorization': { AuthorizationProvider: identity },
    '~/components/loaders/pageLoader': { default: () => null },
    '~/context': { CurrentNavProvider: identity },
    '~/i18n': i18n,
    '~/serverReachability': { checkServerReachability: async () => healthy },
    '~/components/persistentVideo/persistentVideoProvider': { default: identity },
    '~/privacy/privacyPreferences': { PrivacyPreferencesProvider: identity },
    '~/components/uploadPage/uploadSession': { UploadSessionProvider: identity },
  });
  const Providers = load('app/providers.tsx').default;
  const root = createRoot(container);
  container.mountedRoot = root;
  await act(async () => root.render(React.createElement(Providers, null, React.createElement('input', { defaultValue: 'draft title' }))));
  const input = container.querySelector('input'); input.value = 'unsaved work';
  healthy = false;
  await act(async () => window.dispatchEvent(new Event('offline')));
  assert.equal(container.querySelector('input'), input);
  assert.equal(input.value, 'unsaved work');
  assert.match(container.textContent, /connectionInterrupted/);
  healthy = true;
  await act(async () => container.querySelector('button').click());
  assert.equal(container.querySelector('input'), input);
  assert.equal(input.value, 'unsaved work');
  assert.equal(container.querySelector('[role="status"]'), null);
});

test('unknown-total pagination allows the next page without pretending to know a total', async t => {
  const container = dom(t);
  const Pagination = modules({ '~/i18n': i18n, '~/components/customSelect/customSelect': { default: () => null } })('app/components/library/pagination.tsx').default;
  const pages = [];
  const root = createRoot(container);
  container.mountedRoot = root;
  const props = { page: 1, limit: 20, itemCount: 20, hasNextPage: true, label: 'Videos', onPageChange: page => pages.push(page), onLimitChange: () => {} };
  await act(async () => root.render(React.createElement(Pagination, props)));
  assert.equal(container.querySelector('[aria-label="previous"]').disabled, true);
  assert.equal(container.querySelector('[aria-label="next"]').disabled, false);
  await act(async () => container.querySelector('[aria-label="next"]').click());
  assert.deepEqual(pages, [2]);
  await act(async () => root.render(React.createElement(Pagination, { ...props, page: 2, itemCount: 3, hasNextPage: false })));
  assert.equal(container.querySelector('[aria-label="previous"]').disabled, false);
  assert.equal(container.querySelector('[aria-label="next"]').disabled, true);
  assert.match(container.querySelector('[role="status"]').textContent, /"start":21,"end":23/);
});

test('a chapter title containing HTML is displayed literally', t => {
  dom(t);
  const source = fs.readFileSync(path.join(project, 'app/components/playPage/playerCollection/optiflowzTheme/dist/media-theme.js'), 'utf8');
  const start = source.indexOf('class MediaCurrentChapter extends HTMLElement');
  const end = source.indexOf("globalThis.customElements.define('media-current-chapter', MediaCurrentChapter);") + "globalThis.customElements.define('media-current-chapter', MediaCurrentChapter);".length;
  new Function(source.slice(start, end))();
  const outer = document.createElement('div');
  const control = document.createElement('div');
  const chapter = document.createElement('media-current-chapter');
  chapter.append(document.createElement('p')); control.append(chapter); outer.append(control); document.body.append(outer);
  const title = '<img src=x onerror="alert(1)">';
  window.dispatchEvent(new CustomEvent('player:time', { detail: { chapterIndex: 1, chapterName: title } }));
  assert.equal(chapter.querySelector('p').textContent, `1 ${title}`);
  assert.equal(chapter.querySelector('img'), null);
});

test('video collection navigation requests page 2 and shows only that page', async t => {
  const container = dom(t);
  const requests = [];
  const load = modules({
    '~/i18n': i18n,
    '~/functions': { getToken: () => null },
    'react-router': { useParams: () => ({ type: '2' }) },
    'next/navigation': { useRouter: () => ({ replace: () => {} }) },
    '~/privacy/privacyPreferences': { usePrivacyPreferences: () => ({ preferences: { personalization: true }, openPreferences: () => {} }) },
    '~/components/customSelect/customSelect': { default: () => null },
    '../itemSlider/item': { default: ({ props }) => React.createElement('p', { 'data-video': props.id }, props.title) },
    '~/API': { fetchFn: async ({ route }) => {
      const params = new URL(route, 'https://api.example/').searchParams;
      const page = Number(params.get('page')); const limit = Number(params.get('limit'));
      requests.push({ page, limit });
      return { videos: Array.from({ length: page === 1 ? 20 : 3 }, (_, index) => ({ id: `${page}-${index}`, title: `Video ${page}-${index}` })), pagination: { page, limit } };
    } },
  });
  const Page = load('app/components/videosPage/videosPage.tsx').default;
  const client = new QueryClient();
  const root = createRoot(container); container.mountedRoot = root;
  t.after(() => client.clear());
  await act(async () => root.render(React.createElement(QueryClientProvider, { client }, React.createElement(Page))));
  await waitForUpdates();
  assert.equal(container.querySelectorAll('[data-video]').length, 20);
  await act(async () => container.querySelector('[aria-label="next"]').click());
  await waitForUpdates();
  assert.equal(container.querySelectorAll('[data-video]').length, 3);
  assert.equal(container.querySelector('[data-video="1-0"]'), null);
  assert.deepEqual(requests, [{ page: 1, limit: 20 }, { page: 2, limit: 20 }]);
});

test('playlist description can be expanded and collapsed repeatedly without losing its control', async t => {
  const container = dom(t);
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get() { return this.id === 'playlist-description' ? 100 : 0; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return this.classList.contains('open') ? 100 : 40; } });
  const load = modules({
    '~/i18n': i18n,
    '~/authorization/authorization': { useAuthorization: () => ({ can: () => true }) },
    '~/functions': { getToken: () => null, formatDescription: value => value },
    'react-router': { useParams: () => ({ id: 'playlist-1' }) },
    '~/constants': { BookmarkSVG: null, PlaySVG: null, ShareSVG: null },
    '~/env': { env: { siteUrl: 'https://app.example' } },
    '../itemSlider/item': { default: () => null },
    '~/API': { fetchFn: async ({ route }) => route.includes('/videos?') ? { videos: [] } : { playlist: { id: 'playlist-1', title: 'Playlist', description: 'A long description that should be collapsible.', video_count: 0 } } },
  });
  const Page = load('app/components/playlistPage/playlistPage.tsx').default;
  const client = new QueryClient();
  const root = createRoot(container); container.mountedRoot = root;
  t.after(() => client.clear());
  await act(async () => root.render(React.createElement(QueryClientProvider, { client }, React.createElement(Page))));
  await waitForUpdates();
  const control = container.querySelector('[aria-controls="playlist-description"]');
  assert.ok(control);
  for (let i = 0; i < 3; i++) {
    await act(async () => control.click());
    assert.equal(control.textContent, 'readLess');
    assert.equal(control.getAttribute('aria-expanded'), 'true');
    await act(async () => control.click());
    assert.equal(control.textContent, 'readMore');
    assert.equal(control.getAttribute('aria-expanded'), 'false');
    assert.equal(container.querySelector('[aria-controls="playlist-description"]'), control);
  }
});

test('an uninitiated Google callback never exchanges a code or follows its supplied state URL', async t => {
  const container = dom(t);
  window.history.replaceState(null, '', '/google-callback?code=untrusted&state=%2F%2Fevil.example');
  let exchanged = false;
  const load = modules({
    '~/i18n': i18n,
    'react-router': { Link: ({ to, children, ...props }) => React.createElement('a', { href: to, ...props }, children) },
    'next/navigation': { useRouter: () => ({}) },
    '~/API': { fetchFn: async () => { exchanged = true; throw new Error('unexpected exchange'); } },
    '~/components/loaders/loader': { default: () => null },
  });
  const Page = load('app/routes/googleCallback.tsx').default;
  const root = createRoot(container); container.mountedRoot = root;
  await act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(Page))));
  assert.equal(exchanged, false);
  assert.match(container.textContent, /googleLoginRetry/);
  assert.equal(container.querySelector('a').getAttribute('href'), '/login?redirect=%2F');
});
