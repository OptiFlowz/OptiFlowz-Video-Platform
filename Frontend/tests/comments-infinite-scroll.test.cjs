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
    if (!path.extname(file)) file += fs.existsSync(`${file}.ts`) ? '.ts' : '.tsx';
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } }).outputText;
    new Function('require', 'module', 'exports', code)(name => {
      if (name in mocks) return { __esModule: true, ...mocks[name] };
      if (/\.(webp|css)$/.test(name)) return {};
      if (name.startsWith('~/')) return load(path.resolve(__dirname, '../app', name.slice(2)));
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name));
      return require(name);
    }, module, module.exports);
    return module.exports;
  }
  return load;
}
const tText = (key, params) => key + (params ? JSON.stringify(params) : '');
function comment(id, parent_id = null, reply_count = 0) {
  return { id, video_id: 'video', parent_id, reply_count, user_id: 'me', content: id, author_full_name: 'Me', author_image_url: null,
    created_at: '2026-01-01T12:00:00Z', updated_at: '2026-01-01T12:00:00Z', like_count: 0, dislike_count: 0, my_reaction: null };
}
async function fixture(t, { mobile = false, count = 91, fetchFn } = {}) {
  const dom = new JSDOM('<header></header><div id="root"></div>', { url: 'https://example.test/video/video', pretendToBeVisual: true });
  const names = ['window', 'document', 'HTMLElement', 'Element', 'navigator', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT', 'IntersectionObserver'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const key of names) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[key] });
  const observers = new Map();
  globalThis.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; }
    observe(element) { observers.set(this, element); }
    disconnect() { observers.delete(this); }
  };
  let mobileViewport = mobile;
  const mediaListeners = new Set();
  dom.window.matchMedia = () => ({ get matches() { return mobileViewport; },
    addEventListener: (_event, listener) => mediaListeners.add(listener),
    removeEventListener: (_event, listener) => mediaListeners.delete(listener),
  });
  dom.window.scrollTo = () => {};
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const { createRoot } = require('react-dom/client');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  client.setQueryData(['video', 'video'], { id: 'video', comment_count: count });
  const requests = [];
  let composer;
  const load = modules({
    '~/i18n': { useI18n: () => ({ t: tText }), getCurrentLocale: () => 'en' },
    '~/authorization/authorization': { useAuthorization: () => ({ can: () => true, user: { id: 'me' } }) },
    '~/functions': { getToken: () => 'token', getUserImageUrl: () => '', getStoredUser: () => ({ user: { id: 'me', full_name: 'Me' } }) },
    '~/constants': { IconChevron: () => null, CloseSVG: null, CommentSVG: null },
    '~/API': { fetchFn: request => { requests.push(request); return fetchFn(request); } },
    '../../confirmPopup/useConfirm': { useConfirm: () => ({ confirm: async () => true, dialogProps: {} }) },
    '../../confirmPopup/confirmDialog': { ConfirmDialog: () => null },
    '../playerCollection/playerSheet': { default: ({ children }) => children },
    '../playerCollection/sheetScroll': { scrollWithinPlayerSheet: () => false },
    '~/components/customSelect/customSelect': { default: () => null },
    './commentComposer': { default: props => { composer = props; return React.createElement('button', { 'data-submit': true, onClick: props.onSubmit }, 'submit'); } },
    './commentRow': { default: props => React.createElement('article', { 'data-comment-id': props.comment.id }, props.comment.content,
      React.createElement('button', { 'data-action': 'reply', onClick: event => props.onReply(props.comment, event.currentTarget) }, 'reply'),
      React.createElement('button', { 'data-action': 'delete', onClick: () => props.onDelete(props.comment) }, 'delete'),
      React.createElement('button', { 'data-action': 'like', onClick: () => props.onReact(props.comment, 'like') }, String(props.comment.like_count)),
      React.createElement('button', { 'data-action': 'edit', onClick: () => props.onEditStart(props.comment) }, 'edit'),
      props.isEditing && React.createElement('button', { 'data-action': 'save-edit', onClick: () => props.onEditConfirm(props.comment) }, props.editValue),
      props.isEditing && React.createElement('button', { 'data-action': 'change-edit', onClick: () => props.onEditChange('edited') }, 'change')) },
  });
  const Component = load('app/components/playPage/commentCollection/commentsSection.tsx').default;
  const root = createRoot(document.getElementById('root'));
  const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
  await act(async () => root.render(React.createElement(QueryClientProvider, { client }, React.createElement(Component, { videoId: 'video', variant: mobile ? 'drawer' : 'inline' }))));
  await flush();
  t.after(async () => { await act(async () => root.unmount()); client.clear(); dom.window.close(); for (const [name, value] of previous) { if (value) Object.defineProperty(globalThis, name, value); else delete globalThis[name]; } });
  const click = async element => { assert.ok(element, 'Expected clickable element'); await act(async () => element.click()); await flush(); };
  const open = async (id, panel = '.comments-list-view') => {
    const row = document.querySelector(`${panel} [data-comment-id="${id}"]`);
    await click(row?.parentElement.querySelector('button.reply'));
  };
  const intersect = async selector => {
    const matches = [...observers].filter(([, element]) => element.closest(selector));
    assert.equal(matches.length, 1, `Exactly one visible sentinel expected for ${selector}`);
    await act(async () => { matches[0][0].callback([{ isIntersecting: true }]); matches[0][0].callback([{ isIntersecting: true }]); });
    await flush();
  };
  const setMobile = async next => { await act(async () => { mobileViewport = next; mediaListeners.forEach(listener => listener()); }); await flush(); };
  return { client, requests, flush, click, open, root, intersect, observers, setMobile, submit: async text => { await act(async () => composer.onChange(text)); await click(document.querySelector('[data-submit]')); } };
}
function backend() {
  let roots = Array.from({ length: 45 }, (_, i) => comment(`r${i + 1}`, null, i === 0 ? 45 : 0));
  const children = { r1: Array.from({ length: 45 }, (_, i) => comment(`c${i + 1}`, 'r1', i === 0 ? 1 : 0)), c1: [comment('grandchild', 'c1')] };
  let created = 0;
  let failRoute = null;
  const fetchFn = async request => {
    const url = new URL(request.route, 'https://example.test/');
    const parts = url.pathname.split('/');
    const method = request.options.method || 'GET';
    if (method === 'GET' && failRoute && request.route.includes(failRoute)) { failRoute = null; throw new Error('Temporary failure'); }
    if (method === 'POST' && parts.at(-1) === 'post') {
      const body = JSON.parse(request.options.body);
      const next = { ...comment(`created${++created}`, body.parent_id || null), content: body.content };
      if (next.parent_id) {
        children[next.parent_id] ??= []; children[next.parent_id].push(next);
        for (const row of [...roots, ...Object.values(children).flat()]) if (row.id === next.parent_id) row.reply_count++;
      } else roots.unshift(next);
      return { success: true, comment: next };
    }
    if (method === 'DELETE') {
      const id = parts.at(-2);
      roots = roots.filter(row => row.id !== id);
      for (const [parent, rows] of Object.entries(children)) {
        if (rows.some(row => row.id === id)) {
          children[parent] = rows.filter(row => row.id !== id);
          for (const row of [...roots, ...Object.values(children).flat()]) if (row.id === parent) row.reply_count--;
        }
      }
      return { success: true, deleted: true };
    }
    if (method === 'PATCH') {
      const row = [...roots, ...Object.values(children).flat()].find(row => row.id === parts.at(-2));
      row.content = JSON.parse(request.options.body).content;
      return { success: true, comment: { ...row } };
    }
    if (method === 'POST') return { like_count: 1, dislike_count: 0 };
    const page = Number(url.searchParams.get('page')); const limit = Number(url.searchParams.get('limit'));
    if (parts.at(-1) === 'comments') return { comments: structuredClone(roots.slice((page - 1) * limit, page * limit)), total: roots.length, total_pages: Math.ceil(roots.length / limit), page, limit };
    const parent = parts.at(-2);
    const rows = children[parent] || [];
    return { success: true, parent_id: parent, video_id: 'video', replies: structuredClone(rows.slice((page - 1) * limit, page * limit)), pagination: {
      page, limit, total: rows.length, totalPages: Math.ceil(rows.length / limit), hasNextPage: page * limit < rows.length, hasPreviousPage: page > 1,
    }, sorting: { sortBy: 'created_at', sortOrder: 'asc' } };
  };
  return { fetchFn, fail: route => { failRoute = route; } };
}

test('scroll appends roots and direct replies in batches of 20, retains DOM rows and stops at the end', async t => {
  const server = backend(); const f = await fixture(t, { fetchFn: server.fetchFn });
  assert.equal(f.requests.length, 1);
  assert.match(document.querySelector('.comments-header').textContent, /91/);
  assert.equal(document.querySelectorAll('.comments-list-view article').length, 20);
  const firstRoot = document.querySelector('[data-comment-id="r1"]');
  await f.intersect('[data-comments-more]');
  assert.equal(document.querySelectorAll('.comments-list-view article').length, 40);
  assert.equal(document.querySelector('[data-comment-id="r1"]'), firstRoot);
  await f.intersect('[data-comments-more]');
  assert.equal(document.querySelectorAll('.comments-list-view article').length, 45);
  assert.equal(document.querySelector('[data-comments-more] button'), null);
  assert.equal(f.requests.length, 3);
  await f.open('r1');
  assert.equal(f.requests.length, 4);
  assert.equal(document.querySelectorAll('[data-comment-id^="c"]').length, 20);
  const firstReply = document.querySelector('[data-comment-id="c1"]');
  assert.equal(document.querySelector('[data-comment-id="grandchild"]'), null);
  await f.intersect('[data-replies-more="r1"]');
  assert.equal(document.querySelectorAll('[data-comment-id^="c"]').length, 40);
  assert.equal(document.querySelector('[data-comment-id="c1"]'), firstReply);
  await f.intersect('[data-replies-more="r1"]');
  assert.equal(document.querySelectorAll('[data-comment-id^="c"]').length, 45);
  assert.equal(document.querySelector('[data-replies-more="r1"] button'), null);
  await f.open('c1');
  assert.ok(document.querySelector('[data-comment-id="grandchild"]'));
  assert.equal(f.requests.length, 7);
  assert.equal(document.querySelector('[aria-label="adminRowsPerPage"]'), null);
  assert.equal(document.querySelector('nav[aria-label="comments"]'), null);
  assert.ok(f.requests.every(request => request.options.signal));
});

test('append failures retain existing rows and retry only the failed root/reply batch', async t => {
  const server = backend(); const f = await fixture(t, { fetchFn: server.fetchFn });
  server.fail('/comments?limit=20&page=2');
  await f.intersect('[data-comments-more]');
  assert.equal(document.querySelectorAll('.comments-list-view article').length, 20);
  assert.ok(document.querySelector('[data-comments-more] [role="alert"]'));
  const failureCount = f.requests.length;
  await f.flush();
  assert.equal(f.requests.length, failureCount);
  await f.click(document.querySelector('[data-comments-more] button'));
  assert.equal(document.querySelectorAll('.comments-list-view article').length, 40);
  await f.open('r1');
  server.fail('/r1/replies?limit=20&page=2');
  await f.intersect('[data-replies-more="r1"]');
  assert.equal(document.querySelectorAll('[data-comment-id^="c"]').length, 20);
  assert.ok(document.querySelector('[data-replies-more="r1"] [role="alert"]'));
  await f.click(document.querySelector('[data-replies-more="r1"] button'));
  assert.equal(document.querySelectorAll('[data-comment-id^="c"]').length, 40);
  assert.equal(f.requests.filter(request => request.route.endsWith('r1/replies?limit=20&page=1')).length, 1);
  assert.equal(f.requests.filter(request => request.route.endsWith('video/comments?limit=20&page=1')).length, 1);
});

test('mutations preserve accumulated root rows, nested direct-child counts, edits and reactions', async t => {
  const server = backend(); const f = await fixture(t, { fetchFn: server.fetchFn });
  await f.intersect('[data-comments-more]');
  const lastRoot = document.querySelector('[data-comment-id="r40"]');
  const getsBeforePost = f.requests.filter(request => request.options.method === 'GET').length;
  await f.submit('new root');
  assert.ok(document.querySelector('[data-comment-id="created1"]'));
  assert.equal(document.querySelector('[data-comment-id="r40"]'), lastRoot);
  assert.equal(f.requests.filter(request => request.options.method === 'GET').length, getsBeforePost);
  assert.equal(f.client.getQueryData(['video', 'video']).comment_count, 92);
  const rootData = () => f.client.getQueryData(['video-comments', 'video', 'infinite']);
  assert.equal(rootData().pages.length, 2);
  assert.ok(rootData().pages.every(page => page.total === 46));
  await f.click(document.querySelector('[data-comment-id="r2"] [data-action="reply"]'));
  assert.equal(f.requests.filter(request => request.route.includes('/r2/replies')).length, 0);
  await f.submit('first reply');
  assert.ok(document.querySelector('[data-comment-id="created2"]'));
  assert.equal(f.client.getQueryData(['video', 'video']).comment_count, 93);
  await f.click(document.querySelector('[data-comment-id="created2"] [data-action="reply"]'));
  await f.submit('nested reply');
  assert.ok(document.querySelector('[data-comment-id="created3"]'));
  assert.equal(rootData().pages[0].comments.find(row => row.id === 'r2').reply_count, 1);
  await f.click(document.querySelector('[data-comment-id="r35"] [data-action="like"]'));
  assert.equal(document.querySelector('[data-comment-id="r35"] [data-action="like"]').textContent, '1');
  await f.click(document.querySelector('[data-comment-id="r35"] [data-action="edit"]'));
  await f.click(document.querySelector('[data-comment-id="r35"] [data-action="change-edit"]'));
  await f.click(document.querySelector('[data-comment-id="r35"] [data-action="save-edit"]'));
  assert.match(document.querySelector('[data-comment-id="r35"]').textContent, /edited/);
  await f.click(document.querySelector('[data-comment-id="created2"] [data-action="delete"]'));
  assert.equal(document.querySelector('[data-comment-id="created2"]'), null);
  assert.equal(document.querySelector('[data-comment-id="created3"]'), null);
  assert.equal(f.client.getQueryData(['video', 'video']).comment_count, 92);
  await f.click(document.querySelector('[data-comment-id="r35"] [data-action="delete"]'));
  assert.equal(document.querySelector('[data-comment-id="r35"]'), null);
  assert.ok(document.querySelector('[data-comment-id="r40"]'));
  await f.intersect('[data-comments-more]');
  assert.ok(document.querySelector('[data-comment-id="r45"]'));
  assert.equal(document.querySelectorAll('.comments-list-view > div > div > article').length, 45);
  assert.equal(f.client.getQueryData(['video', 'video']).comment_count, 91);
});

test('posting a reply shows it immediately without downloading intervening history or duplicating it later', async t => {
  const server = backend(); const f = await fixture(t, { fetchFn: server.fetchFn });
  await f.open('r1');
  const firstReply = document.querySelector('[data-comment-id="c1"]');
  const getsBefore = f.requests.filter(request => request.options.method === 'GET').length;
  await f.click(document.querySelector('[data-comment-id="r1"] [data-action="reply"]'));
  await f.submit('latest reply');
  assert.equal(f.requests.filter(request => request.options.method === 'GET').length, getsBefore);
  assert.equal(document.querySelector('[data-comment-id="c1"]'), firstReply);
  assert.ok(document.querySelector('[data-comment-id="created1"]'));
  assert.equal(document.querySelector('[data-comment-id="c21"]'), null);
  await f.intersect('[data-replies-more="r1"]');
  await f.intersect('[data-replies-more="r1"]');
  assert.ok(document.querySelector('[data-comment-id="c45"]'));
  assert.equal(document.querySelectorAll('[data-comment-id="created1"]').length, 1);
  assert.equal(document.querySelector('[data-replies-more="r1"] button'), null);
});

test('mobile infinite scroll enables only the active thread and never hidden roots or ancestors', async t => {
  const server = backend(); const f = await fixture(t, { mobile: true, fetchFn: server.fetchFn });
  await f.open('r1');
  assert.equal(f.requests.length, 2);
  assert.equal(document.querySelector('[data-comments-more]'), null);
  assert.equal([...f.observers.values()].some(element => element.closest('[data-comments-more]')), false);
  server.fail('/c1/replies');
  await f.open('c1', '.mobile-thread-view.open');
  assert.equal(document.querySelector('[data-replies-more="r1"]'), null);
  assert.equal(f.observers.size, 0);
  await f.click(document.querySelector('[data-replies-more="c1"] button'));
  assert.ok(document.querySelector('.mobile-thread-view.open [data-comment-id="grandchild"]'));
  assert.equal(f.requests.filter(request => request.route.includes('/video/comments')).length, 1);
  assert.equal(f.requests.filter(request => request.route.includes('/r1/replies')).length, 1);
  await f.click(document.querySelector('.mobile-thread-view-header button'));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 240)); });
  await f.flush();
  assert.ok(document.querySelector('[data-replies-more="r1"]'));
  await f.intersect('[data-replies-more="r1"]');
  assert.ok(document.querySelector('.mobile-thread-view.open [data-comment-id="c40"]'));
  assert.equal(f.requests.filter(request => request.route.includes('/video/comments')).length, 1);
});

test('leaving a video or closing a thread aborts its pending request', async t => {
  const server = backend(); let signal;
  const f = await fixture(t, { fetchFn: request => {
    if (request.route.includes('/replies')) { signal = request.options.signal; return new Promise(() => {}); }
    return server.fetchFn(request);
  } });
  await f.open('r1');
  assert.equal(signal.aborted, false);
  await f.open('r1');
  assert.equal(signal.aborted, true);
  await f.open('r1');
  assert.equal(signal.aborted, false);
  await act(async () => f.root.render(null));
  assert.equal(signal.aborted, true);
});

test('resizing to mobile disables expanded desktop reply queries until their mobile thread is opened', async t => {
  const server = backend(); const f = await fixture(t, { fetchFn: server.fetchFn });
  await f.open('r1');
  const before = f.requests.length;
  await f.setMobile(true);
  assert.equal(document.querySelector('[data-replies-more="r1"]'), null);
  await act(async () => f.client.invalidateQueries({ queryKey: ['comment-replies', 'video'] }));
  await f.flush();
  assert.equal(f.requests.length, before);
  await f.open('r1');
  assert.ok(document.querySelector('.mobile-thread-view.open [data-replies-more="r1"]'));
  assert.equal(f.requests.length, before + 1);
});

test('deletion retries an earlier failed reply page before appending, repairing shifted offsets', async t => {
  const server = backend(); const f = await fixture(t, { fetchFn: server.fetchFn });
  await f.open('r1');
  await f.intersect('[data-replies-more="r1"]');
  server.fail('/r1/replies?limit=20&page=1');
  await f.click(document.querySelector('[data-comment-id="c2"] [data-action="delete"]'));
  assert.ok(document.querySelector('[data-replies-more="r1"] [role="alert"]'));
  assert.equal(document.querySelector('[data-comment-id="c21"]'), null);
  const page2Before = f.requests.filter(request => request.route.includes('/r1/replies?limit=20&page=2')).length;
  await f.click(document.querySelector('[data-replies-more="r1"] button'));
  assert.ok(document.querySelector('[data-comment-id="c21"]'));
  assert.equal(f.requests.filter(request => request.route.includes('/r1/replies?limit=20&page=2')).length, page2Before);
  assert.equal(document.querySelectorAll('[data-comment-id^="c"]').length, 40);
  await f.intersect('[data-replies-more="r1"]');
  assert.equal(document.querySelectorAll('[data-comment-id^="c"]').length, 44);
  assert.equal(document.querySelector('[data-replies-more="r1"] button'), null);
});

test('VideoInfo renders the server aggregate without fetching comments, including desktop without the counter', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.test/video/video' });
  const names = ['window', 'document', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const key of names) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[key] });
  let requests = 0;
  const load = modules({
    '~/i18n': { useI18n: () => ({ t: tText }) },
    '~/authorization/authorization': { useAuthorization: () => ({ can: () => true }) },
    '~/functions': { getToken: () => 'token', formatDate: String, formatViews: String, formatDescription: String },
    '~/constants': {},
    '~/env': { env: {} },
    '~/API': { fetchFn: () => { requests++; }, fetchApiResponse: () => { requests++; } },
    './transcript': { useTranscriptAvailable: () => false },
    './chairPopup': { default: () => null },
    './infoPopup': { default: () => null },
    'react-router': { useLocation: () => ({ pathname: '/video/video', hash: '' }), Link: ({ children, to, ...rest }) => React.createElement('a', { href: to, ...rest }, children) },
  });
  const VideoInfo = load('app/components/playPage/playerCollection/videoInfo.tsx').default;
  const { createRoot } = require('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); for (const [name, value] of previous) { if (value) Object.defineProperty(globalThis, name, value); else delete globalThis[name]; } });
  const props = { id: 'video', title: 'Example video', description: '', tags: [], people: [], categories: [], view: { counted: false }, comment_count: 9000 };
  const render = (mobile, count = 9000) => act(async () => root.render(React.createElement(VideoInfo, {
    props: { ...props, comment_count: count }, onOpenComments: mobile ? () => {} : undefined,
    onOpenChapter: () => {}, onOpenTranscript: () => {},
  })));
  await render(true);
  assert.match(document.querySelector('.viewVideoComments').textContent, /9000/);
  await render(true, 9001);
  assert.match(document.querySelector('.viewVideoComments').textContent, /9001/);
  await render(false);
  assert.equal(document.querySelector('.viewVideoComments'), null);
  assert.equal(requests, 0);
});
