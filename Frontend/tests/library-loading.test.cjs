const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { JSDOM } = require('jsdom');
const { act } = React;
const { QueryClient, QueryClientProvider } = require('@tanstack/react-query');

function modules(mocks) {
  const cache = new Map();
  function load(file) {
    file = path.resolve(__dirname, '..', file);
    if (!path.extname(file)) file += fs.existsSync(file + '.ts') ? '.ts' : '.tsx';
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } }).outputText;
    new Function('require', 'module', 'exports', code)(name => {
      if (name in mocks) return { __esModule: true, ...mocks[name] };
      if (name.endsWith('.css') || name.endsWith('.webp')) return { __esModule: true, default: {} };
      if (name.startsWith('~/')) return load('app/' + name.slice(2));
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name));
      return require(name);
    }, module, module.exports);
    return module.exports;
  }
  return load;
}
const flush = () => act(() => new Promise(resolve => setTimeout(resolve, 25)));
const tLabel = (key, values) => key + (values ? JSON.stringify(values) : '');
const i18n = { useI18n: () => ({ t: tLabel }) };
const Link = ({ to, children, ...props }) => React.createElement('a', { href: to, ...props }, children);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function setup(t) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.test', pretendToBeVisual: true });
  const globals = ['window', 'document', 'HTMLElement', 'CustomEvent', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT', 'IntersectionObserver'];
  const previous = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of globals) Object.defineProperty(globalThis, key, { value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[key], writable: true, configurable: true });
  dom.window.HTMLElement.prototype.scrollTo = () => {};
  const observers = new Set();
  globalThis.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; }
    observe() { observers.add(this); }
    disconnect() { observers.delete(this); }
  };
  const { createRoot } = require('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  t.after(async () => {
    await act(async () => root.unmount()); client.clear(); dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  return {
    client,
    render: async element => { await act(async () => root.render(React.createElement(QueryClientProvider, { client }, element))); await flush(); },
    click: async element => { assert.ok(element); await act(async () => element.click()); await flush(); },
    intersect: async () => { await act(async () => { for (const observer of [...observers]) observer.callback([{ isIntersecting: true }]); }); await flush(); },
  };
}
function playlistLoader(fetchFn, navigate) {
  return modules({
    '~/API': { fetchFn }, '~/i18n': i18n, '~/env': { env: { siteUrl: 'https://example.test' } },
    '~/functions': { getToken: () => 'token' }, '~/constants': {},
    '~/authorization/authorization': { useAuthorization: () => ({ can: () => false }) },
    '~/authorization/permissions': { P: {} },
    'react-router': { Link, useLocation: () => ({ pathname: '/video/v1', search: '', hash: '' }), useNavigate: () => navigate },
    './playerSheet': { default: ({ children, header }) => React.createElement('section', null, header(() => {}), children) },
    './playCard': { default: ({ props, playedVideoId }) => React.createElement('a', { 'data-video': props.id, className: props.id === playedVideoId ? 'active' : '' }, props.id) },
  });
}
const playlistPage = (page, total = 100) => ({ videos: Array.from({ length: Math.min(20, total - (page - 1) * 20) }, (_, index) => ({ id: `v${(page - 1) * 20 + index + 1}` })),
  pagination: { page, limit: 20, total, totalPages: Math.ceil(total / 20), hasNextPage: page * 20 < total } });

test('playlist renders its first page without reading the whole collection; failed append keeps rows and retries', async t => {
  const ui = setup(t); const pages = []; let fail = true;
  const load = playlistLoader(async ({ route, options }) => {
    assert.ok(options.signal);
    if (!route.includes('/videos?')) return { playlist: { id: 'p', title: 'Playlist', video_count: 100 } };
    const page = Number(new URL(route, 'https://api.test').searchParams.get('page')); pages.push(page);
    if (page === 2 && fail) { fail = false; throw new Error('temporary'); }
    return playlistPage(page);
  }, () => {});
  const Playlist = load('app/components/playPage/playerCollection/playingPlaylist.tsx').default;
  await ui.render(React.createElement(Playlist, { playlistId: 'p', videoId: 'v1', onClose() {} }));
  assert.deepEqual(pages, [1]);
  assert.equal(document.querySelectorAll('[data-video]').length, 20);
  await ui.intersect();
  assert.deepEqual(pages, [1, 2]);
  assert.equal(document.querySelectorAll('[data-video]').length, 20);
  assert.match(document.querySelector('[role="alert"]').textContent, /searchLoadFailed/);
  await ui.click([...document.querySelectorAll('button')].find(button => button.textContent === 'usersRetry'));
  assert.deepEqual(pages, [1, 2, 2]);
  assert.equal(document.querySelectorAll('[data-video]').length, 40);
  assert.equal(document.querySelector('.active').textContent, 'v1');
});

test('playlist autoplay waits for the successor across a page boundary and ignores another video', async t => {
  const ui = setup(t); const second = deferred(); const pages = []; const navigations = [];
  const load = playlistLoader(async ({ route }) => {
    if (!route.includes('/videos?')) return { playlist: { id: 'p', title: 'Playlist', video_count: 100 } };
    const page = Number(new URL(route, 'https://api.test').searchParams.get('page')); pages.push(page);
    return page === 2 ? second.promise : playlistPage(page);
  }, route => navigations.push(route));
  const Playlist = load('app/components/playPage/playerCollection/playingPlaylist.tsx').default;
  const { requestPlaylistAdvance } = load('app/components/playPage/playerCollection/playlistAutoplay.ts');
  await ui.render(React.createElement(Playlist, { playlistId: 'p', videoId: 'v20', onClose() {} }));
  assert.deepEqual(pages, [1, 2]);
  assert.equal(document.querySelectorAll('[data-video]').length, 20, 'show page 1 while successor is loading');
  await act(async () => requestPlaylistAdvance('v19')); assert.deepEqual(navigations, []);
  await act(async () => requestPlaylistAdvance('v20')); assert.deepEqual(navigations, []);
  await act(async () => second.resolve(playlistPage(2))); await flush();
  assert.deepEqual(navigations, ['/video/v21?p=p']);
  assert.deepEqual(pages, [1, 2], 'do not read page 3 after finding the successor');
});

test('playlist finds a deep-linked active video and reads only one successor page; disabled autoplay stays put', async t => {
  const ui = setup(t); const pages = []; const navigations = [];
  const load = playlistLoader(async ({ route }) => {
    if (!route.includes('/videos?')) return { playlist: { id: 'p', title: 'Playlist', video_count: 100 } };
    const page = Number(new URL(route, 'https://api.test').searchParams.get('page')); pages.push(page); return playlistPage(page);
  }, route => navigations.push(route));
  const Playlist = load('app/components/playPage/playerCollection/playingPlaylist.tsx').default;
  const { requestPlaylistAdvance } = load('app/components/playPage/playerCollection/playlistAutoplay.ts');
  await ui.render(React.createElement(Playlist, { playlistId: 'p', videoId: 'v40', onClose() {} }));
  await flush(); await flush();
  assert.deepEqual(pages, [1, 2, 3]);
  assert.equal(document.querySelector('.active').textContent, 'v40');
  localStorage.setItem('autoplay', 'false');
  await act(async () => requestPlaylistAdvance('v40'));
  assert.deepEqual(navigations, []);
});

function searchLoader(fetchFn) {
  return modules({
    '~/API': { fetchFn }, '~/videoDiscovery': { fetchVectorVideos: fetchFn }, '~/i18n': i18n,
    '~/functions': { getToken: () => 'token' }, '~/components/shared/videoMedia': { getVideoThumbnail: () => '' },
    'react-router': { useParams: () => ({ searchValue: 'surgery' }), useSearchParams: () => [new URLSearchParams()], useNavigate: () => () => {}, Link },
    './searchIcons': { SearchIcon: () => null }, './searchResultCard': { default: ({ result }) => React.createElement('p', { 'data-result': result.kind }, result.id) },
    '~/components/customSelect/customSelect': { default: () => null },
  });
}
const searchKind = url => url.pathname.includes('playlists') ? 'playlists' : url.pathname.includes('people') ? 'people' : 'videos';
const searchResponse = (kind, total, limit, page = 1) => ({ [kind]: Array.from({ length: Math.min(limit, Math.max(0, total - (page - 1) * limit)) }, (_, i) => ({ id: `${kind}${(page - 1) * limit + i}`, title: 'Title', name: 'Name' })), pagination: { total, limit, page, totalPages: Math.ceil(total / limit) } });

test('search downloads full pages only for the selected tab, retains exact counts and reuses visited tab pages', async t => {
  const ui = setup(t); const requests = [];
  const load = searchLoader(async ({ route, options }) => {
    assert.ok(options.signal); const url = new URL(route, 'https://api.test');
    const kind = searchKind(url); const limit = Number(url.searchParams.get('limit')); const page = Number(url.searchParams.get('page'));
    requests.push({ kind, limit, page }); return searchResponse(kind, 35, limit, page);
  });
  const Page = load('app/components/searchPage/searchPage.tsx').default;
  await ui.render(React.createElement(Page)); await flush();
  assert.deepEqual(requests, [{ kind: 'videos', limit: 10, page: 1 }, { kind: 'playlists', limit: 1, page: 1 }, { kind: 'people', limit: 1, page: 1 }]);
  assert.equal(document.querySelectorAll('[data-result]').length, 10);
  const tabs = () => [...document.querySelectorAll('[aria-pressed]')];
  assert.ok(tabs().every(tab => tab.textContent.endsWith('35')));
  await ui.click(tabs()[1]);
  assert.deepEqual(requests.at(-1), { kind: 'playlists', limit: 10, page: 1 });
  await ui.intersect();
  assert.deepEqual(requests.at(-1), { kind: 'playlists', limit: 10, page: 2 });
  assert.equal(document.querySelectorAll('[data-result]').length, 20);
  const beforeReturn = requests.length;
  await ui.click(tabs()[0]); await ui.click(tabs()[1]);
  assert.equal(requests.length, beforeReturn);
  assert.equal(document.querySelectorAll('[data-result]').length, 20);
});

test('search waits for the first nonempty category in order and never overrides an explicit selection', async t => {
  const ui = setup(t); const playlists = deferred(); const requests = [];
  const load = searchLoader(async ({ route }) => {
    const url = new URL(route, 'https://api.test'); const kind = searchKind(url); const limit = Number(url.searchParams.get('limit'));
    requests.push({ kind, limit });
    if (kind === 'playlists' && limit === 1) return playlists.promise;
    return searchResponse(kind, kind === 'videos' ? 0 : 5, limit);
  });
  const Page = load('app/components/searchPage/searchPage.tsx').default;
  await ui.render(React.createElement(Page)); await flush();
  const tabs = () => [...document.querySelectorAll('[aria-pressed]')];
  assert.equal(tabs()[0].getAttribute('aria-pressed'), 'true', 'people count must not win while playlist count is pending');
  await act(async () => playlists.resolve(searchResponse('playlists', 3, 1))); await flush(); await flush();
  assert.equal(tabs()[1].getAttribute('aria-pressed'), 'true');
  assert.ok(requests.some(request => request.kind === 'playlists' && request.limit === 10));
  await ui.click(tabs()[0]); await flush();
  assert.equal(tabs()[0].getAttribute('aria-pressed'), 'true', 'user may deliberately select an empty category');
  assert.ok(!requests.some(request => request.kind === 'people' && request.limit === 10));
});

test('channel fetches full content only for its active tab while retaining the header count', async t => {
  const ui = setup(t); const requests = []; const listeners = new Set(); let pathname = '/channel/c/playlists';
  const navigate = route => { pathname = route; listeners.forEach(listener => listener()); };
  const load = modules({
    '~/API': { fetchFn: async ({ route, options }) => {
      assert.ok(options.signal); requests.push(route);
      if (route.includes('/videos?')) return { videos: [{ id: 'v' }], pagination: { total: 87 } };
      if (route.includes('/playlists?')) return { playlists: [{ id: 'p' }], pagination: { total: 1 } };
      return { channel: { id: 'c', full_name: 'Channel' } };
    } },
    '~/i18n': i18n, '~/env': { env: {} }, '~/functions': { getToken: () => 'token', formatDescription: text => text }, '~/constants': {},
    'react-router': { useParams: () => ({ id: 'c' }), useLocation: () => ({ pathname: React.useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => pathname) }), useNavigate: () => navigate },
    '../customSelect/customSelect': { default: () => null }, '../itemSlider/item': { default: () => React.createElement('article', { 'data-video': true }) },
    '../itemSlider/playlistItem': { default: () => React.createElement('article', { 'data-playlist': true }) }, '../posts/ChannelPosts': { default: () => null },
  });
  const Page = load('app/components/channelPage/channelPage.tsx').default;
  await ui.render(React.createElement(Page));
  assert.ok(requests.includes('api/channels/c/videos?limit=1&page=1'));
  assert.ok(!requests.some(route => route.includes('/videos?sortBy=')));
  assert.match(document.querySelector('.channelVideoCount').textContent, /87/);
  assert.equal(document.querySelectorAll('[data-video]').length, 0);
  await ui.click(document.querySelectorAll('[role="tab"]')[0]);
  assert.ok(requests.some(route => route.includes('/videos?sortBy=')));
  assert.equal(document.querySelectorAll('[data-playlist]').length, 0, 'inactive cards are unmounted');
  const beforeReturn = requests.length;
  await ui.click(document.querySelectorAll('[role="tab"]')[1]);
  assert.equal(requests.length, beforeReturn, 'recent tab data stays cached');
});

for (const hydrated of [true, false]) {
  test(`channel posts request the legacy video fallback only when needed (hydrated=${hydrated})`, async t => {
    const ui = setup(t); const requests = [];
    const video = { id: 'v', title: 'Embedded video' };
    const post = { id: 'post', blocks: [{ id: 'block', type: 'video', videoId: 'v', ...(hydrated ? { video } : {}) }] };
    const load = modules({
      '~/i18n': i18n, '~/functions': { getToken: () => 'token' },
      './api': { getChannelPosts: async () => ({ posts: [post], pagination: { hasNextPage: false } }) },
      '~/API': { fetchFn: async ({ route, options }) => { requests.push(route); assert.ok(options.signal); return { videos: [video] }; } },
      './PostCard': { default: ({ post, videos }) => React.createElement('p', { 'data-embedded': true }, (post.blocks[0].video ?? videos.find(item => item.id === 'v'))?.title ?? 'unavailable') },
    });
    const Posts = load('app/components/posts/ChannelPosts.tsx').default;
    await ui.render(React.createElement(Posts, { channelId: 'c', author: {}, videos: [], ascending: false })); await flush();
    assert.equal(requests.length, hydrated ? 0 : 1);
    assert.equal(document.querySelector('[data-embedded]').textContent, 'Embedded video');
  });
}

test('an explicit search selection during count loading is retained when the pending count completes', async t => {
  const ui = setup(t); const playlists = deferred();
  const load = searchLoader(async ({ route }) => {
    const url = new URL(route, 'https://api.test'); const kind = searchKind(url); const limit = Number(url.searchParams.get('limit'));
    if (kind === 'playlists' && limit === 1) return playlists.promise;
    return searchResponse(kind, kind === 'videos' ? 0 : 5, limit);
  });
  const Page = load('app/components/searchPage/searchPage.tsx').default;
  await ui.render(React.createElement(Page)); await flush();
  const tabs = () => [...document.querySelectorAll('[aria-pressed]')];
  await ui.click(tabs()[2]);
  await act(async () => playlists.resolve(searchResponse('playlists', 3, 1))); await flush();
  assert.equal(tabs()[2].getAttribute('aria-pressed'), 'true');
});

test('the last playlist video does not advance or fetch beyond the declared last page', async t => {
  const ui = setup(t); const pages = []; const navigations = [];
  const load = playlistLoader(async ({ route }) => {
    if (!route.includes('/videos?')) return { playlist: { id: 'p', title: 'Playlist', video_count: 20 } };
    const page = Number(new URL(route, 'https://api.test').searchParams.get('page')); pages.push(page); return playlistPage(page, 20);
  }, route => navigations.push(route));
  const Playlist = load('app/components/playPage/playerCollection/playingPlaylist.tsx').default;
  const { requestPlaylistAdvance } = load('app/components/playPage/playerCollection/playlistAutoplay.ts');
  await ui.render(React.createElement(Playlist, { playlistId: 'p', videoId: 'v20', onClose() {} }));
  await act(async () => requestPlaylistAdvance('v20')); await flush();
  assert.deepEqual(pages, [1]); assert.deepEqual(navigations, []);
});
