const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { JSDOM } = require('jsdom');

function modules(mocks) {
  const cache = new Map();
  function load(file) {
    file = path.resolve(file);
    if (!path.extname(file)) file += fs.existsSync(`${file}.ts`) ? '.ts' : '.tsx';
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function('require', 'module', 'exports', code)(name => {
      if (name in mocks) return mocks[name];
      if (name.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
      if (/\.(webp|png)$/.test(name)) return '/thumbnail.webp';
      if (name.startsWith('~/')) return load(path.join(__dirname, '../app', name.slice(2)));
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name));
      return require(name);
    }, mod, mod.exports);
    return mod.exports;
  }
  return relative => load(path.join(__dirname, '../app/components/collections', relative));
}

test('collection requests follow the new backend contract, preserve nullable fields and multipart boundaries', async () => {
  const calls = []; let token = 'viewer-token';
  const load = modules({ '~/functions': { getToken: () => token }, '~/API': { fetchFn: async input => { calls.push(input); return {}; } } });
  const api = load('api.ts');
  await api.getCollections({ userId: 'owner', title: ' A & B ', page: 2, limit: 10, sortBy: 'title', sortOrder: 'asc', visibility: 'private' });
  const params = new URL(calls.at(-1).route, 'https://test.local').searchParams;
  assert.equal(params.get('userId'), 'owner'); assert.equal(params.get('title'), 'A & B'); assert.equal(params.get('page'), '2');
  assert.equal(params.get('sortBy'), 'title'); assert.equal(params.get('visibility'), 'private'); assert.equal(params.has('q'), false);
  await api.updateCollection('c', { title: ' New ', subheading: ' ', description: '', visibility: 'private', thumbnail_url: 'must-not-leak' });
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), { title: 'New', subheading: null, description: null, visibility: 'private' });
  await api.updateCollectionVisibility('c', 'public');
  assert.equal(calls.at(-1).options.method, 'PATCH');
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), { visibility: 'public' });
  await api.addPlaylists('c', ['p1', 'p2']); assert.equal(calls.at(-1).options.method, 'POST');
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), { playlist_ids: ['p1', 'p2'] });
  await api.savePlaylistOrder('c', ['p2', 'p1']); assert.equal(calls.at(-1).route, 'api/collections/c/playlists/reorder'); assert.equal(calls.at(-1).options.method, 'PATCH');
  await api.removePlaylist('c', 'p1'); assert.equal(calls.at(-1).route, 'api/collections/c/playlists/p1'); assert.equal(calls.at(-1).options.method, 'DELETE');
  await api.uploadThumbnail('c', new File(['image'], 'cover.png', { type: 'image/png' }));
  assert.ok(calls.at(-1).options.body instanceof FormData); assert.equal(calls.at(-1).options.body.get('file').name, 'cover.png');
  assert.equal(calls.at(-1).options.headers['Content-Type'], undefined);
  await api.uploadThumbnail('c'); assert.equal(calls.at(-1).options.body.get('file'), null);
  token = null; await api.getCollection('c'); assert.equal(calls.at(-1).options.headers.Authorization, undefined);
});

test('collection editor serializes writes, preserves drafts, refreshes after conflicts, and respects resource ownership', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://test.local/edit-collection?collection=c' });
  const names = ['window', 'document', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  const { act } = React, { createRoot } = require('react-dom/client'), { QueryClient, QueryClientProvider } = require('@tanstack/react-query');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); client.clear(); dom.window.close(); for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  const collection = { id: 'c', title: 'Original', subheading: 'Subtitle', description: 'Description', visibility: 'private', thumbnail_url: null, created_by: 'owner' };
  let playlists = [{ id: 'p1', title: 'First' }, { id: 'p2', title: 'Second' }], owner = 'owner', failOrder = true, releaseAdd;
  const calls = [], navigation = [];
  const noop = () => null;
  const auth = { user: { id: 'owner' }, can: () => true, canOwn: (own, any, id) => id === owner };
  const load = modules({
    '~/functions': { getToken: () => 'token' }, '~/constants': { UploadSVG: null }, '~/i18n': { useI18n: () => ({ t: key => key }) },
    '~/authorization/authorization': { useAuthorization: () => auth },
    'react-router': { Link: ({ to, children }) => React.createElement('a', { href: to }, children), useSearchParams: () => [new URLSearchParams(dom.window.location.search)], useNavigate: () => href => navigation.push(href) },
    '~/components/myVideosPage/sidebar/sidebar': { default: noop, __esModule: true },
    '~/components/confirmPopup/confirmDialog': { ConfirmDialog: noop }, '~/components/confirmPopup/useConfirm': { useConfirm: () => ({ confirm: async () => true, dialogProps: { open: false } }) },
    '~/components/shared/thumbnailDropZone': { ThumbnailDropZone: ({ children }) => React.createElement('section', null, children) },
    '~/components/customSelect/customSelect': { default: ({ id, value, options, onChange, disabled }) => React.createElement('select', { id, value, disabled, onChange: e => onChange(e.target.value) }, options.map(o => React.createElement('option', { key: o.value, value: o.value }, o.label))), __esModule: true },
    './PlaylistPicker': { default: ({ onAdd, busy }) => React.createElement('button', { id: 'add-playlist', disabled: busy, onClick: () => onAdd('p3') }, 'Add'), __esModule: true },
    './CollectionPlaylistList': { default: ({ videos, onMove, onDelete, disabled }) => React.createElement('div', { id: 'members' }, videos.map(v => React.createElement('span', { key: v.id }, v.id)), React.createElement('button', { id: 'move', disabled, onClick: () => onMove('p2', 'p1') }, 'Move'), React.createElement('button', { id: 'remove', disabled, onClick: () => onDelete('p1') }, 'Remove')), __esModule: true },
    '~/API': { fetchFn: async ({ route, options }) => {
      calls.push({ route, ...options }); const body = options.body && !(options.body instanceof FormData) ? JSON.parse(options.body) : null;
      if (route === 'api/collections/c' && options.method === 'GET') return structuredClone({ collection, playlists });
      if (route === 'api/collections/c' && options.method === 'PATCH') { Object.assign(collection, body); return { collection: structuredClone(collection) }; }
      if (route.endsWith('/playlists/reorder')) { if (failOrder) throw Object.assign(new Error('Conflict'), { status: 409 }); playlists.reverse(); return {}; }
      if (route.endsWith('/playlists') && options.method === 'POST') { await new Promise(resolve => { releaseAdd = resolve; }); playlists.push({ id: 'p3', title: 'Third' }); return {}; }
      if (route.endsWith('/playlists/p1') && options.method === 'DELETE') { playlists = playlists.filter(p => p.id !== 'p1'); return {}; }
      if (route === 'api/collections' && options.method === 'POST') return { collection: { id: 'created' } };
      throw new Error(`Unexpected request: ${route}`);
    } },
  });
  const Editor = load('CollectionEditor.tsx').default;
  const render = () => root.render(React.createElement(QueryClientProvider, { client }, React.createElement(Editor)));
  const settle = async () => { for (let i = 0; i < 4; i++) await act(async () => { await new Promise(r => setTimeout(r, 10)); }); };
  await act(async () => render()); await settle();
  const input = document.querySelector('input[maxlength="255"]');
  await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, 'Unsaved draft'); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
  await act(async () => document.getElementById('move').click()); await settle();
  assert.match(document.body.textContent, /collectionConflict/); assert.equal(document.querySelector('input[maxlength="255"]').value, 'Unsaved draft');
  assert.deepEqual([...document.querySelectorAll('#members span')].map(el => el.textContent), ['p1', 'p2']);
  failOrder = false; await act(async () => document.getElementById('move').click()); await settle();
  assert.deepEqual([...document.querySelectorAll('#members span')].map(el => el.textContent), ['p2', 'p1']);
  await act(async () => { document.getElementById('add-playlist').click(); document.getElementById('add-playlist').click(); });
  assert.equal(calls.filter(c => c.route.endsWith('/playlists') && c.method === 'POST').length, 1);
  await act(async () => releaseAdd()); await settle();
  assert.equal(document.querySelector('input[maxlength="255"]').value, 'Unsaved draft');
  await act(async () => document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))); await settle();
  assert.equal(collection.title, 'Unsaved draft');
  await act(async () => document.getElementById('remove').click()); await settle();
  assert.deepEqual(playlists.map(p => p.id), ['p2', 'p3']);
  assert.ok(calls.some(c => c.method === 'DELETE' && c.route === 'api/collections/c/playlists/p1'));
  assert.equal(calls.some(c => c.method === 'DELETE' && c.route.startsWith('api/playlists')), false);
  owner = 'someone-else'; await act(async () => render());
  assert.match(document.body.textContent, /collectionUnavailable/); assert.equal(document.querySelector('form'), null);
  dom.window.history.replaceState(null, '', '/edit-collection'); await act(async () => render());
  const title = document.querySelector('input[maxlength="255"]');
  await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(title, 'New collection'); title.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
  await act(async () => document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))); await settle();
  assert.deepEqual(navigation, ['/edit-collection?collection=created']);
});

test('thumbnail validation rejects unsupported formats and oversized files; invalid reorder targets preserve membership', () => {
  const { validCollectionThumbnail, reorderPlaylists } = modules({})('model.ts');
  assert.equal(validCollectionThumbnail({ type: 'image/svg+xml', size: 100 }), false);
  assert.equal(validCollectionThumbnail({ type: 'image/png', size: 5 * 1024 * 1024 + 1 }), false);
  assert.equal(validCollectionThumbnail({ type: 'image/jpeg', size: 0 }), false);
  assert.equal(validCollectionThumbnail({ type: 'image/webp', size: 5 * 1024 * 1024 }), true);
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.equal(reorderPlaylists(items, 'absent', 'a'), items);
  assert.deepEqual(reorderPlaylists(items, 'c', 'a').map(i => i.id), ['c', 'a', 'b']);
  assert.deepEqual(items.map(i => i.id), ['a', 'b', 'c']);
});

test('new collection previews a cover and retries failed uploads without creating duplicates', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://test.local/edit-collection' });
  const names = ['window', 'document', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  const { act } = React, { createRoot } = require('react-dom/client'), { QueryClient, QueryClientProvider } = require('@tanstack/react-query');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); client.clear(); dom.window.close(); for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  const calls = [], navigation = []; let failUpload = true;
  const noop = () => null;
  const load = modules({
    '~/functions': { getToken: () => 'token' }, '~/constants': { UploadSVG: null }, '~/i18n': { useI18n: () => ({ t: key => key }) },
    '~/authorization/authorization': { useAuthorization: () => ({ can: () => true }) },
    'react-router': { Link: ({ to, children }) => React.createElement('a', { href: to }, children), useSearchParams: () => [new URLSearchParams()], useNavigate: () => href => navigation.push(href) },
    '~/components/myVideosPage/sidebar/sidebar': { default: noop, __esModule: true },
    '~/components/confirmPopup/confirmDialog': { ConfirmDialog: noop }, '~/components/confirmPopup/useConfirm': { useConfirm: noop },
    '~/components/shared/thumbnailDropZone': { ThumbnailDropZone: ({ children }) => React.createElement('section', null, children) },
    '~/components/customSelect/customSelect': { default: noop, __esModule: true },
    './PlaylistPicker': { default: noop, __esModule: true }, './CollectionPlaylistList': { default: noop, __esModule: true },
    '~/API': { fetchFn: async ({ route, options }) => {
      calls.push({ route, ...options });
      if (route === 'api/collections') return { collection: { id: 'new-id' } };
      if (route === 'api/collections/new-id/thumbnail') { if (failUpload) throw new Error('Upload failed'); return {}; }
      throw new Error(`Unexpected request: ${route}`);
    } },
  });
  const Editor = load('CollectionEditor.tsx').default;
  await act(async () => root.render(React.createElement(QueryClientProvider, { client }, React.createElement(Editor))));
  const title = document.querySelector('input[maxlength="255"]');
  await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(title, 'Collection with cover'); title.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
  const fileInput = document.querySelector('input[type="file"]');
  const choose = async file => act(async () => { Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] }); fileInput.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
  await choose(new File(['invalid'], 'bad.svg', { type: 'image/svg+xml' }));
  assert.match(document.querySelector('[role="alert"]').textContent, /collectionThumbnailHelp/);
  const cover = new File(['valid test payload'], 'cover.png', { type: 'image/png' });
  await choose(cover);
  assert.match(document.querySelector('img').src, /^blob:/);
  assert.equal(document.querySelector('[role="alert"]'), null);
  const submit = () => document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await act(async () => { submit(); submit(); });
  assert.deepEqual(calls.map(c => c.route), ['api/collections', 'api/collections/new-id/thumbnail']);
  assert.equal(calls[1].body.get('file').name, 'cover.png');
  assert.match(document.querySelector('[role="alert"]').textContent, /collectionCoverUploadFailed/);
  assert.equal(title.disabled, true);
  assert.match(document.querySelector('img').src, /^blob:/);
  assert.deepEqual(navigation, []);
  failUpload = false;
  await act(async () => submit());
  assert.equal(calls.filter(c => c.route === 'api/collections').length, 1);
  assert.equal(calls.filter(c => c.route.endsWith('/thumbnail')).length, 2);
  assert.deepEqual(navigation, ['/edit-collection?collection=new-id']);
});

test('collection visibility supports cancel, failed save retry, cache refresh, and permission checks', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://test.local/my-collections' });
  const names = ['window', 'document', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  globalThis.requestAnimationFrame = cb => setTimeout(cb, 0);
  globalThis.cancelAnimationFrame = clearTimeout;
  const focusOptions = [];
  const nativeFocus = dom.window.HTMLElement.prototype.focus;
  dom.window.HTMLElement.prototype.focus = function(options) { focusOptions.push(options); return nativeFocus.call(this, options); };
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const { act } = React, { createRoot } = require('react-dom/client'), { QueryClient, QueryClientProvider, useQuery } = require('@tanstack/react-query');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); client.clear(); dom.window.close(); for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  let collection = { id: 'c', title: 'Preserve this title', created_by: 'owner', visibility: 'private' }, canEdit = true, fail = true, release;
  const calls = [];
  const load = modules({
    '~/functions': { getToken: () => 'token' }, '~/constants': { PublicSVG: null, PrivateSVG: null }, '~/i18n': { useI18n: () => ({ t: key => key }) },
    '~/authorization/authorization': { useAuthorization: () => ({ canOwn: () => canEdit }) },
    '~/components/library/rowActionSheet': { __esModule: true, default: ({ children }) => React.createElement('div', { role: 'dialog' }, children) },
    '~/API': { fetchFn: async ({ options }) => {
      if (options.method === 'GET') return { collection: { ...collection } };
      const body = JSON.parse(options.body); calls.push(body);
      if (fail) throw new Error('Network failure');
      await new Promise(resolve => { release = resolve; });
      collection = { ...collection, ...body }; return { collection };
    } },
  });
  const Visibility = load('CollectionVisibility.tsx').default, api = load('api.ts');
  function Harness() { const { data } = useQuery({ queryKey: ['collections', 'c'], queryFn: () => api.getCollection('c') }); return data ? React.createElement(Visibility, { collection: data.collection }) : null; }
  const render = () => root.render(React.createElement(QueryClientProvider, { client }, React.createElement(Harness)));
  const settle = async () => { for (let i = 0; i < 3; i++) await act(async () => { await new Promise(r => setTimeout(r, 10)); }); };
  const button = label => [...document.querySelectorAll('button')].find(b => b.textContent === label);
  const click = async el => act(async () => el.click());
  await act(async () => render()); await settle();
  await click(document.querySelector('.collectionVisibility'));
  assert.equal(document.activeElement.value, 'private');
  await act(async () => document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })));
  assert.equal(document.activeElement, button('adminSave'));
  await click(document.querySelector('input[value="public"]'));
  await click(button('adminCancel'));
  assert.ok(document.querySelector('[role="dialog"]').hasAttribute('inert'));
  assert.equal(document.querySelector('[role="dialog"]').classList.contains('isOpen'), false);
  await act(async () => { await new Promise(r => setTimeout(r, 220)); });
  assert.equal(document.querySelector('[role="dialog"]'), null); assert.equal(calls.length, 0);
  await click(document.querySelector('.collectionVisibility'));
  assert.equal(document.querySelector('input:checked').value, 'private');
  await click(document.querySelector('input[value="public"]'));
  await click(button('adminSave'));
  assert.ok(document.querySelector('[role="alert"]')); assert.ok(document.querySelector('[role="dialog"]'));
  assert.equal(document.querySelector('input:checked').value, 'public');
  fail = false;
  await act(async () => { button('adminSave').click(); button('adminSave').click(); });
  assert.equal(calls.length, 2); assert.ok(document.querySelector('fieldset').disabled);
  await act(async () => release()); await settle();
  await act(async () => { await new Promise(r => setTimeout(r, 220)); });
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.match(document.querySelector('.collectionVisibility').textContent, /adminPublic/);
  assert.deepEqual(calls, [{ visibility: 'public' }, { visibility: 'public' }]);
  assert.equal(collection.title, 'Preserve this title');
  assert.ok(focusOptions.length > 0);
  assert.ok(focusOptions.every(options => options?.preventScroll === true));
  canEdit = false; await act(async () => render());
  assert.equal(document.querySelector('.collectionVisibility').tagName, 'SPAN');
});

test('playlist picker appends on intersection, retains results on failure, and resets when source changes', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://test.local/edit-collection' });
  const names = ['window', 'document', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT', 'IntersectionObserver'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  let intersect;
  globalThis.IntersectionObserver = class { constructor(cb) { this.cb = cb; } observe() { intersect = () => this.cb([{ isIntersecting: true }]); } disconnect() { intersect = null; } };
  const { act } = React, { createRoot } = require('react-dom/client'), { QueryClient, QueryClientProvider } = require('@tanstack/react-query');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); client.clear(); dom.window.close(); for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  const calls = []; let fail = true;
  const load = modules({
    '~/functions': { getToken: () => 'token' }, '~/constants': { AddSVG: null, CheckSVG: null }, '~/i18n': { useI18n: () => ({ t: key => key }) },
    '~/authorization/authorization': { useAuthorization: () => ({ can: () => true }) },
    '~/components/customSelect/customSelect': { __esModule: true, default: ({ value, onChange, options }) => React.createElement('select', { value, onChange: e => onChange(e.target.value) }, options.map(o => React.createElement('option', { key: o.value, value: o.value }, o.label))) },
    './api': { findCollectionPlaylists: async (scope, search, page) => {
      calls.push({ scope, search, page });
      if (scope === 'public') return { playlists: [{ id: 'public', title: 'Public playlist' }], total: 1 };
      if (page === 2 && fail) throw new Error('Temporary failure');
      return { playlists: Array.from({ length: page === 1 ? 10 : 2 }, (_, i) => ({ id: `p${(page - 1) * 10 + i}`, title: `Playlist ${(page - 1) * 10 + i}` })), total: 12 };
    } },
  });
  const Picker = load('PlaylistPicker.tsx').default;
  await act(async () => root.render(React.createElement(QueryClientProvider, { client }, React.createElement(Picker, { included: ['p0'], busy: false, onAdd() {} }))));
  const settle = async () => { for (let i = 0; i < 3; i++) await act(async () => { await new Promise(r => setTimeout(r, 10)); }); };
  await settle();
  assert.equal(document.querySelectorAll('.playlistVideoSearchRow').length, 10);
  assert.equal(document.querySelector('.playlistVideoAddBtn').disabled, true);
  assert.ok(intersect);
  await act(async () => intersect()); await settle();
  assert.equal(document.querySelectorAll('.playlistVideoSearchRow').length, 10);
  assert.ok(document.querySelector('[role="alert"]'));
  fail = false;
  await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent === 'usersRetry').click()); await settle();
  assert.equal(document.querySelectorAll('.playlistVideoSearchRow').length, 12);
  assert.equal(document.querySelector('[role="alert"]'), null); assert.equal(intersect, null);
  const select = document.querySelector('select');
  await act(async () => { select.value = 'public'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }); await settle();
  assert.equal(document.querySelectorAll('.playlistVideoSearchRow').length, 1);
  assert.match(document.querySelector('.playlistVideoSearchRow').textContent, /Public playlist/);
  assert.deepEqual(calls.map(c => [c.scope, c.page]), [['mine', 1], ['mine', 2], ['mine', 2], ['public', 1]]);
});

test('collection selection supports select all, partial bulk failure, cancellation and page changes', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://test.local/my-collections' });
  const names = ['window', 'document', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  const { act } = React, { createRoot } = require('react-dom/client'), { QueryClient, QueryClientProvider } = require('@tanstack/react-query');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); client.clear(); dom.window.close(); for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  let items = ['a', 'b', 'c'].map(id => ({ id, title: id, visibility: 'private', created_by: id === 'c' ? 'other' : 'owner' }));
  let approve = true, fail = true;
  const writes = [], noop = () => null;
  const load = modules({
    '~/functions': { getToken: () => 'token', formatDate: () => 'Date' }, '~/constants': {}, '~/i18n': { useI18n: () => ({ t: (key, params) => key + (params?.title ? ':' + params.title : '') }) },
    '~/authorization/authorization': { useAuthorization: () => ({ user: { id: 'owner' }, can: () => true, canOwn: (own, any, owner) => owner === 'owner' }) },
    'react-router': { Link: ({ to, children, ...props }) => React.createElement('a', { href: to, ...props }, children) },
    '~/components/myVideosPage/sidebar/sidebar': { default: noop, __esModule: true },
    '~/components/confirmPopup/confirmDialog': { ConfirmDialog: noop }, '~/components/confirmPopup/useConfirm': { useConfirm: () => ({ confirm: async () => approve, dialogProps: {} }) },
    '~/components/library/librarySortButton': { default: ({ label, onClick }) => React.createElement('button', { onClick }, label), __esModule: true },
    '~/components/library/pagination': { default: ({ onPageChange }) => React.createElement('button', { onClick: () => onPageChange(2) }, 'Next page'), __esModule: true },
    './CollectionVisibility': { default: ({ collection }) => collection.visibility, __esModule: true },
    './api': {
      getCollections: async ({ page }) => ({ collections: page === 1 ? items.map(i => ({ ...i })) : [], pagination: { total: 4, totalPages: 2 } }),
      updateCollectionVisibility: async (id, visibility) => { writes.push({ id, visibility }); if (fail && id === 'b') throw new Error('Failed'); items = items.map(item => item.id === id ? { ...item, visibility } : item); },
      deleteCollection: async id => { writes.push({ id, delete: true }); items = items.filter(item => item.id !== id); },
    },
  });
  const Page = load('MyCollectionsPage.tsx').default;
  const settle = async () => { for (let i = 0; i < 3; i++) await act(async () => { await new Promise(r => setTimeout(r, 10)); }); };
  const check = label => document.querySelector(`input[aria-label="${label}"]`);
  const button = label => [...document.querySelectorAll('button')].find(b => b.textContent === label);
  const click = async el => { await act(async () => el.click()); await settle(); };
  await act(async () => root.render(React.createElement(QueryClientProvider, { client }, React.createElement(Page)))); await settle();
  assert.ok(check('collectionSelect:c').disabled);
  await click(check('collectionSelect:a'));
  assert.equal(check('collectionSelectAll').indeterminate, true);
  await click(check('collectionSelectAll'));
  assert.equal(check('collectionSelectAll').checked, true);
  assert.equal(check('collectionSelect:b').checked, true);
  approve = false; await click(button('adminDeleteAll')); assert.equal(writes.length, 0);
  assert.equal(check('collectionSelectAll').checked, true);
  approve = true; await click(button('adminMakePublic'));
  assert.deepEqual(writes, [{ id: 'a', visibility: 'public' }, { id: 'b', visibility: 'public' }]);
  assert.equal(check('collectionSelect:a').checked, false); assert.equal(check('collectionSelect:b').checked, true);
  assert.ok(document.querySelector('[role="alert"]'));
  fail = false; await click(button('adminMakePublic'));
  assert.equal(check('collectionSelect:b').checked, false); assert.equal(document.querySelector('[role="alert"]'), null);
  await click(check('collectionSelectAll')); await click(button('adminDeleteAll'));
  assert.deepEqual(items.map(i => i.id), ['c']);
  assert.ok(check('collectionSelectAll').disabled);
  items = [{ id: 'd', title: 'd', visibility: 'private', created_by: 'owner' }];
  await act(async () => client.invalidateQueries({ queryKey: ['collections'] })); await settle();
  await click(check('collectionSelect:d')); await click(button('Next page'));
  assert.equal(button('adminDeleteAll'), undefined);
  assert.equal(check('collectionSelectAll').checked, false);
});
