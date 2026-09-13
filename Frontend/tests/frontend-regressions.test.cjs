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

for (const kind of ['video', 'playlist']) {
  test(`editor ${kind} deletion respects permissions, confirmation, failures and pending requests`, async t => {
    const container = dom(t);
    let allowed = false;
    let confirmed = false;
    let confirmations = 0;
    let respond = async () => ({ success: false });
    const requests = [];
    const navigations = [];
    const invalidations = [];
    const load = modules({
      '~/i18n': i18n,
      '~/authorization/authorization': { useAuthorization: () => ({ canAny: () => allowed }) },
      '~/functions': { getToken: () => 'editor-token' },
      '~/constants': { DeleteSVG: React.createElement('svg') },
      '~/API': { fetchFn: async request => { requests.push(request); return respond(); } },
      'react-router': { useNavigate: () => (...args) => navigations.push(args) },
      '@tanstack/react-query': { useQueryClient: () => ({ invalidateQueries: options => { invalidations.push(options); return Promise.resolve(); } }) },
      '~/components/confirmPopup/useConfirm': {
        useConfirm: () => ({
          confirm: async options => {
            confirmations++;
            assert.match(options.title, /Saved title/);
            return confirmed;
          },
          dialogProps: { open: false },
        }),
      },
      '~/components/confirmPopup/confirmDialog': { ConfirmDialog: () => null },
    });
    const { EditorHeader } = load('app/components/shared/editorHeader.tsx');
    const root = createRoot(container); container.mountedRoot = root;
    const render = disabled => act(async () => root.render(React.createElement(EditorHeader, {
      kind, id: 'item-1', resourceTitle: 'Saved title', heading: 'Edit', disabled,
    }, 'Details')));
    const click = () => act(async () => container.querySelector('button').click());

    await render(false);
    assert.equal(container.querySelector('button'), null);
    allowed = true;
    await render(true);
    await click();
    assert.equal(confirmations, 0);
    await render(false);
    await click();
    assert.equal(confirmations, 1);
    assert.equal(requests.length, 0, 'cancelling must not delete');

    confirmed = true;
    await click();
    assert.equal(navigations.length, 0);
    assert.ok(container.querySelector('[role="alert"]'));
    respond = async () => { throw new Error('Network unavailable'); };
    await click();
    assert.equal(navigations.length, 0);
    assert.equal(invalidations.length, 0);
    assert.equal(container.querySelector('button').disabled, false, 'failure permits retry');

    let finish;
    respond = () => new Promise(resolve => { finish = resolve; });
    const count = requests.length;
    await act(async () => {
      container.querySelector('button').click();
      container.querySelector('button').click();
    });
    assert.equal(requests.length, count + 1, 'double click sends one request');
    assert.equal(container.querySelector('button').disabled, true);
    const request = requests.at(-1);
    assert.equal(request.route, kind === 'video' ? 'api/video-moderation/video/item-1' : 'api/playlists-moderation/playlist/item-1');
    assert.equal(request.options.method, 'DELETE');
    assert.equal(request.options.headers.Authorization, 'Bearer editor-token');
    await act(async () => finish({ success: true }));
    const list = kind === 'video' ? 'my-videos' : 'my-playlists';
    assert.deepEqual(invalidations, [{ queryKey: [list] }]);
    assert.deepEqual(navigations, [[`/${list}`, { replace: true }]]);
    assert.equal(container.querySelector('[role="alert"]'), null);
  });
}

test('timeline storyboards use the storyboard credential and follow token/video changes', () => {
  const { getPlaybackStoryboardUrl } = modules({
    '~/API': { fetchFn: () => {} },
    '~/functions': { getToken: () => 'user' },
  })('app/components/playback/useVideoPlayback.ts');
  const playback = { mux_playback_id: 'video-1', playback_policy: 'signed', tokens: { playback: 'video-token', thumbnail: 'image-token', storyboard: 'storyboard-token' } };
  const url = new URL(getPlaybackStoryboardUrl(playback));
  assert.equal(url.origin, 'https://image.mux.com');
  assert.equal(url.pathname, '/video-1/storyboard.vtt');
  assert.equal(url.searchParams.get('token'), 'storyboard-token');
  assert.equal(url.searchParams.get('format'), 'webp');
  const refreshed = new URL(getPlaybackStoryboardUrl({ ...playback, mux_playback_id: 'video-2', tokens: { storyboard: 'renewed-token' } }));
  assert.equal(refreshed.pathname, '/video-2/storyboard.vtt');
  assert.equal(refreshed.searchParams.get('token'), 'renewed-token');
  assert.equal(getPlaybackStoryboardUrl({ ...playback, tokens: {} }), undefined);
  assert.equal(getPlaybackStoryboardUrl(undefined), undefined);
  assert.equal(new URL(getPlaybackStoryboardUrl({ ...playback, playback_policy: 'public', tokens: {} })).searchParams.has('token'), false);
});

test('search params decode once on refresh and navigation, preserving literal percent signs', async t => {
  const container = dom(t);
  let pathname = '/search/Where%20The%20Trade%20Winds%20Blow';
  let params = { searchValue: ['Where%20The%20Trade%20Winds%20Blow'] };
  const { useParams } = modules({
    'next/navigation': { useParams: () => params, usePathname: () => pathname },
    'next/link': { default: identity },
  })('next/react-router.tsx');
  const Consumer = () => React.createElement('output', null, useParams().searchValue);
  const root = createRoot(container); container.mountedRoot = root;
  const render = () => act(async () => root.render(React.createElement(Consumer)));
  await render();
  assert.equal(container.textContent, 'Where The Trade Winds Blow');
  params = { searchValue: ['Where The Trade Winds Blow'] };
  await render();
  assert.equal(container.textContent, 'Where The Trade Winds Blow');
  for (const term of ['100% ready', 'literal %20', 'Šta & kako/a+b?', 'two  spaces']) {
    pathname = `/search/${encodeURIComponent(term)}`;
    params = { searchValue: [term] };
    await render();
    assert.equal(container.textContent, term);
  }
  pathname = '/search/bad%ZZ';
  await render();
  assert.equal(container.textContent, 'bad%ZZ');
});

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

test('watch history retains numbered pagination and shows only the selected page', async t => {
  const container = dom(t);
  const requests = [];
  const load = modules({
    '~/i18n': i18n,
    '~/functions': { getToken: () => 'user' },
    'react-router': { useParams: () => ({ type: '4' }) },
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

test('vector discovery preserves parameters, authorization, cancellation and response pagination for all supported routes', async () => {
  for (const route of [
    'api/videos/search?q=Obrada%20%26%20zvuk&page=2&limit=10&sort=relevance',
    'api/videos/video-id/similar?page=2&limit=20',
    'api/videos/user/recommended?page=1&limit=20',
  ]) {
    const requests = [];
    const options = { headers: { Authorization: 'Bearer user' }, signal: new AbortController().signal };
    const vector = { videos: [{ id: 'semantic' }], pagination: { total: 21, page: 2, limit: 10, totalPages: 3 } };
    const regular = { videos: [{ id: 'keyword' }], pagination: { total: 1, page: 1, limit: 10, totalPages: 1 } };
    let vectorResult = vector;
    const { fetchVectorVideos } = modules({ '~/API': { fetchFn: async request => {
      requests.push(request);
      return request.route.includes('/vector') ? vectorResult : regular;
    } } })('app/videoDiscovery.ts');
    assert.equal(await fetchVectorVideos({ route, options }), vector);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].route, route.replace('?', '/vector?'));
    assert.equal(requests[0].options, options);
    requests.length = 0;
    vectorResult = { videos: [], pagination: { total: 0 } };
    assert.equal(await fetchVectorVideos({ route, options }), regular);
    assert.deepEqual(requests.map(request => request.route), [route.replace('?', '/vector?'), route]);
    assert.ok(requests.every(request => request.options === options));
  }
});

test('filter-only browsing stays on ordinary search; unpaginated similar discovery supports fallback', async () => {
  const requests = [];
  const { fetchVectorVideos } = modules({ '~/API': { fetchFn: async ({ route }) => {
    requests.push(route); return { videos: [] };
  } } })('app/videoDiscovery.ts');
  for (const query of ['category=category-id', 'tags=tag-id', 'person=person-id', 'q=']) {
    const route = `api/videos/search?${query}&page=1&limit=10`;
    await fetchVectorVideos({ route, options: {} });
    assert.equal(requests.pop(), route);
    assert.equal(requests.length, 0);
  }
  await fetchVectorVideos({ route: 'api/videos/video-id/similar', options: {} });
  assert.deepEqual(requests, ['api/videos/video-id/similar/vector', 'api/videos/video-id/similar']);
});

test('vector errors and aborted requests never trigger ordinary search', async () => {
  for (const error of [Object.assign(new Error('Unauthorized'), { status: 401 }), Object.assign(new Error('Forbidden'), { status: 403 }), new Error('Server unavailable')]) {
    let calls = 0;
    const { fetchVectorVideos } = modules({ '~/API': { fetchFn: async () => { calls++; throw error; } } })('app/videoDiscovery.ts');
    await assert.rejects(fetchVectorVideos({ route: 'api/videos/search?q=topic', options: {} }), actual => actual === error);
    assert.equal(calls, 1);
  }
  const controller = new AbortController();
  let calls = 0;
  const { fetchVectorVideos } = modules({ '~/API': { fetchFn: async () => { calls++; controller.abort(); return { videos: [] }; } } })('app/videoDiscovery.ts');
  await assert.rejects(fetchVectorVideos({ route: 'api/videos/search?q=topic', options: { signal: controller.signal } }), { name: 'AbortError' });
  assert.equal(calls, 1);
});

for (const surface of ['page', 'slider']) {
  for (const scenario of ['new-user', 'watched-all', 'vector-results', 'fallback-results', 'history-error', 'personalization-disabled']) {
    test(`${surface} recommendations: ${scenario}`, async t => {
      const container = dom(t);
      const requests = [];
      const load = modules({
        '~/i18n': i18n,
        '~/functions': { getToken: () => 'user' },
        'react-router': { useParams: () => ({ type: '1' }), Link: identity },
        'next/navigation': { useRouter: () => ({ replace: () => {} }) },
        '~/authorization/authorization': { useAuthorization: () => ({ can: () => true }) },
        '~/context': { CurrentNavContext: React.createContext({ setCurrentNav: () => {} }) },
        '~/constants': { ArrowSVG: null },
        '~/privacy/privacyPreferences': { usePrivacyPreferences: () => ({ preferences: { personalization: scenario !== 'personalization-disabled' }, openPreferences: () => {} }) },
        '~/components/customSelect/customSelect': { default: () => null },
        '../itemSlider/item': { default: ({ props }) => React.createElement('p', { 'data-video': props.id }, props.title) },
        './item': { default: ({ props }) => React.createElement('p', { 'data-video': props.id }, props.title) },
        './playlistItem': { default: () => null },
        '~/API': { fetchFn: async ({ route, options }) => {
          requests.push(route);
          assert.equal(new Headers(options.headers).get('Authorization'), 'Bearer user');
          assert.ok(options.signal instanceof AbortSignal);
          if (route.includes('/history')) {
            if (scenario === 'history-error') throw new Error('History unavailable');
            return { videos: scenario === 'watched-all' ? [{ id: 'watched' }] : [] };
          }
          const populated = scenario === 'vector-results' || (scenario === 'fallback-results' && !route.includes('/vector'));
          return { videos: populated ? [{ id: 'result', title: 'Recommended video' }] : [], pagination: { total: populated ? 1 : 0, totalPages: 1 } };
        } },
      });
      const Component = load(surface === 'page' ? 'app/components/videosPage/videosPage.tsx' : 'app/components/itemSlider/itemSlider.tsx').default;
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const root = createRoot(container); container.mountedRoot = root;
      t.after(() => client.clear());
      await act(async () => root.render(React.createElement(QueryClientProvider, { client }, React.createElement(Component, { props: { type: 1, limit: 20 } }))));
      await waitForUpdates();
      if (scenario === 'personalization-disabled') {
        assert.deepEqual(requests, []);
        assert.doesNotMatch(container.textContent, /watchSomeVideos|noMoreRecommendations/);
        return;
      }
      assert.match(requests[0], /^api\/videos\/user\/recommended\/vector\?/);
      if (scenario === 'vector-results' || scenario === 'fallback-results') {
        assert.match(container.textContent, /Recommended video/);
        assert.equal(requests.length, scenario === 'vector-results' ? 1 : 2);
      } else {
        assert.equal(requests.length, 3);
        assert.equal(requests[1], requests[0].replace('/vector', ''));
        assert.equal(requests[2], 'api/videos/user/history?page=1&limit=1');
        if (scenario === 'history-error') {
          assert.match(container.querySelector('[role="alert"]').textContent, /searchLoadFailed/);
          assert.doesNotMatch(container.textContent, /watchSomeVideos|noMoreRecommendations/);
        } else {
          assert.match(container.textContent, new RegExp(scenario === 'watched-all' ? 'noMoreRecommendations' : 'watchSomeVideos'));
          assert.doesNotMatch(container.textContent, new RegExp(scenario === 'watched-all' ? 'watchSomeVideos' : 'noMoreRecommendations'));
        }
      }
    });
  }
}

function intersectionObserver(t) {
  const previous = globalThis.IntersectionObserver;
  const observers = new Set();
  globalThis.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; }
    observe() { observers.add(this); }
    disconnect() { observers.delete(this); }
  };
  t.after(() => { globalThis.IntersectionObserver = previous; });
  return async () => {
    await act(async () => {
      for (const observer of [...observers]) {
        // Browsers can report multiple intersections before React commits loading state.
        observer.callback([{ isIntersecting: true }]);
        observer.callback([{ isIntersecting: true }]);
      }
    });
    await waitForUpdates();
  };
}

test('infinite results respect both pagination formats, unknown totals, empty and repeated pages', () => {
  const { nextResultsPage, uniqueResults } = modules()('app/components/library/infiniteResults.ts');
  const getItems = response => response.videos;
  const first = { videos: [{ id: 'a' }, { id: 'b' }] };
  const second = { videos: [{ id: 'c' }, { id: 'd' }] };
  assert.equal(nextResultsPage(first, [first], 1, 2, getItems), 2);
  assert.equal(nextResultsPage({ ...second, videos: [{ id: 'c' }] }, [first, second], 2, 2, getItems), undefined);
  for (const pagination of [{ totalPages: 2 }, { total_pages: 2 }, { total: 4 }, { hasNextPage: false }]) {
    assert.equal(nextResultsPage({ ...second, pagination }, [first, second], 2, 2, getItems), undefined);
  }
  assert.equal(nextResultsPage({ ...first, pagination: { total: 4 } }, [first], 1, 2, getItems), 2);
  assert.equal(nextResultsPage({ ...first, pagination: { total: 8, limit: 2 } }, [first], 1, 20, getItems), 2);
  assert.equal(nextResultsPage(first, [first, first], 2, 2, getItems), undefined);
  assert.equal(nextResultsPage({ videos: [], pagination: { total: 100 } }, [first], 2, 2, getItems), undefined);
  assert.deepEqual(uniqueResults([...first.videos, { id: 'b' }, ...second.videos]).map(item => item.id), ['a', 'b', 'c', 'd']);
});

for (const type of ['1', '2']) {
  test(`${type === '1' ? 'recommended' : 'trending'} scroll appends results, retains them on failure, retries and stops at the end`, async t => {
    const container = dom(t);
    const scroll = intersectionObserver(t);
    const requests = [];
    let fail = true;
    const load = modules({
      '~/i18n': i18n,
      '~/functions': { getToken: () => 'user' },
      'react-router': { useParams: () => ({ type }) },
      'next/navigation': { useRouter: () => ({ replace: () => {} }) },
      '~/privacy/privacyPreferences': { usePrivacyPreferences: () => ({ preferences: { personalization: true }, openPreferences: () => {} }) },
      '../itemSlider/item': { default: ({ props }) => React.createElement('p', { 'data-video': props.id }, props.title) },
      '~/API': { fetchFn: async ({ route }) => {
        const url = new URL(route, 'https://api.example/');
        const page = Number(url.searchParams.get('page'));
        requests.push({ path: url.pathname, page });
        if (page === 2 && fail) throw new Error('Temporary failure');
        return { videos: page === 1 ? Array.from({ length: 20 }, (_, i) => ({ id: `v${i}`, title: `Video ${i}` })) : [{ id: 'v19', title: 'Duplicate' }, { id: 'v20', title: 'Last video' }], pagination: { totalPages: 2 } };
      } },
    });
    const Page = load('app/components/videosPage/videosPage.tsx').default;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const root = createRoot(container); container.mountedRoot = root;
    t.after(() => client.clear());
    await act(async () => root.render(React.createElement(QueryClientProvider, { client }, React.createElement(Page))));
    await waitForUpdates();
    assert.equal(container.querySelectorAll('[data-video]').length, 20);
    assert.doesNotMatch(container.textContent, /adminRowsPerPage/);
    await scroll();
    assert.equal(container.querySelectorAll('[data-video]').length, 20);
    assert.match(container.querySelector('[role="alert"]').textContent, /searchLoadFailed/);
    await scroll();
    assert.equal(requests.length, 2, 'failed pages must not automatically retry on every intersection');
    fail = false;
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'usersRetry').click());
    await waitForUpdates();
    assert.equal(container.querySelectorAll('[data-video]').length, 21);
    assert.equal(container.querySelectorAll('[data-video="v19"]').length, 1);
    assert.equal(container.querySelector('[role="alert"]'), null);
    assert.match(container.textContent, /Last video/);
    await scroll();
    assert.deepEqual(requests.map(request => request.page), [1, 2, 2]);
    assert.ok(requests.every(request => request.path === (type === '1' ? '/api/videos/user/recommended/vector' : '/api/videos/trending')));
  });
}

test('search scroll appends each content type independently and resets results for sort and query changes', async t => {
  const container = dom(t);
  const scroll = intersectionObserver(t);
  const requests = [];
  let searchValue = 'video';
  const load = modules({
    '~/i18n': i18n,
    '~/functions': { getToken: () => 'user' },
    'react-router': { useParams: () => ({ searchValue }), useSearchParams: () => [new URLSearchParams()], useNavigate: () => () => {}, Link: identity },
    './searchIcons': { SearchIcon: () => null },
    './searchResultCard': { default: ({ result }) => React.createElement('p', { 'data-result': `${result.kind}-${result.id}` }, result.title) },
    '~/components/customSelect/customSelect': { default: ({ onChange }) => React.createElement('button', { onClick: () => onChange('views') }, 'sort-views') },
    '~/API': { fetchFn: async ({ route }) => {
      const url = new URL(route, 'https://api.example/');
      const kind = url.pathname.includes('/videos/') ? 'videos' : url.pathname.includes('/playlists/') ? 'playlists' : 'people';
      const page = Number(url.searchParams.get('page'));
      const q = url.searchParams.get('q'); const sort = url.searchParams.get('sort') || 'relevance';
      requests.push({ kind, page, q, sort });
      return { [kind]: Array.from({ length: page === 1 ? 10 : 1 }, (_, i) => ({ id: `${q}-${sort}-${page}-${i}`, title: `${q} ${sort}`, name: `${q} ${sort}` })), pagination: { total: 11, limit: 10 } };
    } },
  });
  const Page = load('app/components/searchPage/searchPage.tsx').default;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(container); container.mountedRoot = root;
  t.after(() => client.clear());
  const render = () => root.render(React.createElement(QueryClientProvider, { client }, React.createElement(Page)));
  await act(async () => render());
  await waitForUpdates();
  assert.equal(container.querySelectorAll('[data-result]').length, 10);
  assert.doesNotMatch(container.textContent, /adminRowsPerPage/);
  await scroll();
  assert.equal(container.querySelectorAll('[data-result]').length, 11);
  assert.deepEqual(requests.filter(request => request.page === 2).map(request => request.kind), ['videos']);
  for (const index of [1, 2]) {
    await act(async () => container.querySelectorAll('[aria-pressed]')[index].click());
    assert.equal(container.querySelectorAll('[data-result]').length, 10);
    await scroll();
    assert.equal(container.querySelectorAll('[data-result]').length, 11);
  }
  await act(async () => container.querySelectorAll('[aria-pressed]')[0].click());
  assert.equal(container.querySelectorAll('[data-result]').length, 11);
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'sort-views').click());
  await waitForUpdates();
  assert.equal(container.querySelectorAll('[data-result]').length, 10);
  assert.ok([...container.querySelectorAll('[data-result]')].every(node => node.textContent === 'video views'));
  assert.ok(requests.filter(request => request.sort === 'views').every(request => request.page === 1));
  searchValue = 'new query';
  await act(async () => render());
  await waitForUpdates();
  assert.equal(container.querySelectorAll('[data-result]').length, 10);
  assert.ok([...container.querySelectorAll('[data-result]')].every(node => node.textContent === 'new query relevance'));
  assert.ok(requests.filter(request => request.q === 'new query').every(request => request.page === 1));
});

for (const scenario of ['invalid-id', 'not-found', 'deleted-cached-video', 'empty-response', 'server-error', 'valid-video']) {
  test(`video page handles ${scenario} without mounting controls for an unavailable video`, async t => {
    const container = dom(t);
    window.matchMedia = () => ({ matches: false });
    const videoId = scenario === 'invalid-id' ? 'f50c7ede-99cf-451d-ada6-d3d0e30a8191h' : 'f50c7ede-99cf-451d-ada6-d3d0e30a8191';
    const requests = [];
    const mounted = [];
    const control = name => ({ props }) => {
      React.useEffect(() => { mounted.push(name); }, []);
      return React.createElement('div', { 'data-control': name }, props?.title ?? name);
    };
    const load = modules({
      '~/i18n': i18n,
      '~/functions': { getToken: () => 'user' },
      'react-router': { useParams: () => ({ videoId }), useNavigate: () => () => {}, useLocation: () => ({ pathname: `/video/${videoId}`, search: '' }) },
      './playerCollection/playerCollection': { default: control('player') },
      './playerCollection/videoInfo': { default: control('info') },
      './playerCollection/similar': { default: control('similar') },
      './playerCollection/videoChapters': { default: control('chapters') },
      './playerCollection/playingPlaylist': { default: control('playlist') },
      './inPlaylist': { default: control('in-playlist') },
      './commentsSection': { default: control('comments') },
      '~/API': { fetchFn: async ({ route, options }) => {
        requests.push(route);
        assert.ok(options.signal instanceof AbortSignal);
        if (route.includes('/similar')) return { videos: [{ id: 'other' }] };
        if (scenario === 'not-found' || scenario === 'deleted-cached-video') throw Object.assign(new Error('Video not found'), { status: 404 });
        if (scenario === 'server-error') throw Object.assign(new Error('Unavailable'), { status: 503 });
        if (scenario === 'empty-response') return null;
        return { id: videoId, title: 'Playable video' };
      } },
    });
    const Page = load('app/components/playPage/playPage.tsx').default;
    const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
    if (scenario === 'deleted-cached-video') client.setQueryData(['video', videoId], { id: videoId, title: 'Cached deleted video' });
    const root = createRoot(container); container.mountedRoot = root;
    t.after(() => client.clear());
    await act(async () => root.render(React.createElement(QueryClientProvider, { client }, React.createElement(Page))));
    await waitForUpdates();
    if (scenario === 'valid-video') {
      assert.ok(container.querySelector('[data-control="player"]'));
      assert.ok(container.querySelector('[data-control="comments"]'));
      assert.ok(requests.includes(`api/videos/${videoId}/similar/vector`));
    } else {
      assert.deepEqual(mounted, [], 'unavailable videos must never mount the player, comments or related panels');
      assert.equal(container.querySelector('.player-skeleton'), null);
      assert.equal(container.querySelector('[aria-busy="true"]'), null);
      assert.ok(requests.every(route => route === `api/videos/${videoId}`));
      if (scenario === 'server-error') {
        assert.match(container.textContent, /videoAnalyticsLoadFailed/);
        assert.doesNotMatch(container.textContent, /videoNotFound/);
        assert.ok([...container.querySelectorAll('button')].some(button => button.textContent === 'usersRetry'));
        assert.equal(requests.length, 3);
      } else {
        assert.equal(container.textContent, 'videoNotFound');
        assert.equal(requests.length, scenario === 'invalid-id' ? 0 : 1);
      }
    }
  });
}

test('a player mounted after video loading survives pending layout measurements and anchor replacement', async t => {
  const container = dom(t);
  const video = { id: '8fc293a2-15a8-466d-b8e5-6c21ad64e133', title: 'Existing video', people: [], percentage_watched: 0, progress_seconds: 0 };
  let pathname = `/video/${video.id}`;
  let measured = false;
  let loaded = false;
  let anchorKey = 0;
  const resizeCallbacks = new Set();
  const originals = new Map(['ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame'].map(key => [key, globalThis[key]]));
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; }
    observe() { resizeCallbacks.add(this.callback); }
    disconnect() { resizeCallbacks.delete(this.callback); }
  };
  globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);
  globalThis.cancelAnimationFrame = clearTimeout;
  t.after(() => { for (const [key, value] of originals) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
  window.matchMedia = () => ({ matches: false });
  HTMLElement.prototype.getBoundingClientRect = function () {
    return { top: 100, left: 50, width: measured ? 800 : 0, height: measured ? 450 : 0 };
  };
  const load = modules({
    'next/navigation': { usePathname: () => pathname, useRouter: () => ({ push: () => {} }) },
    '~/components/playPage/playerCollection/muxPlayer': { default: ({ videoId }) => React.createElement('div', { 'data-media': videoId }) },
    './useFloatingMiniPlayer': { useFloatingMiniPlayer: () => ({ miniPlayerRef: React.useRef(null), safeAreaRef: React.useRef(null), isPositionReady: true }) },
    './usePlayerMorphTransition': { usePlayerMorphTransition: () => false },
  });
  const Provider = load('app/components/persistentVideo/persistentVideoProvider.tsx').default;
  const Player = load('app/components/playPage/playerCollection/playerCollection.tsx').default;
  const root = createRoot(container); container.mountedRoot = root;
  const render = () => root.render(React.createElement(Provider, null, loaded ? React.createElement(Player, { key: anchorKey, props: video }) : React.createElement('p', null, 'Loading video')));
  await act(async () => render());
  assert.equal(container.querySelector('[data-media]'), null);
  await act(async () => { loaded = true; render(); });
  await waitForUpdates();
  assert.ok(container.querySelector('[data-media]'), 'the playback session must survive until the anchor can be measured');
  assert.equal(container.querySelector('aside').getAttribute('aria-hidden'), 'true');
  await act(async () => { measured = true; for (const callback of resizeCallbacks) callback(); });
  await waitForUpdates();
  assert.equal(container.querySelector('aside').getAttribute('aria-hidden'), 'false');
  assert.equal(container.querySelector('aside').style.width, '800px');
  await act(async () => { measured = false; anchorKey++; render(); });
  await waitForUpdates();
  assert.ok(container.querySelector('[data-media]'), 'replacing a player anchor on the same video must not close the session');
  await act(async () => { measured = true; for (const callback of resizeCallbacks) callback(); });
  await waitForUpdates();
  assert.equal(container.querySelector('aside').getAttribute('aria-hidden'), 'false');
  await act(async () => { pathname = '/'; loaded = false; render(); });
  await waitForUpdates();
  assert.equal(container.querySelector('[data-media]'), null, 'leaving a paused video still clears the session');
});
