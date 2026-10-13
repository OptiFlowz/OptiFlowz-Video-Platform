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

test('video picker browses mine/public, appends pages, retries failures, filters and prevents adding existing videos', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://test.local/edit-playlist' });
  const names = ['window', 'document', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT', 'IntersectionObserver'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  let intersect, allowMine = true, failNext = true;
  globalThis.IntersectionObserver = class { constructor(cb) { this.cb = cb; } observe() { intersect = () => this.cb([{ isIntersecting: true }]); } disconnect() { intersect = null; } };
  const { act } = React, { createRoot } = require('react-dom/client'), { QueryClient, QueryClientProvider } = require('@tanstack/react-query');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); client.clear(); dom.window.close(); for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  const requests = [], added = [];
  async function request({ route, options }) {
    requests.push({ route, options });
    const url = new URL(route, 'https://test.local'), page = Number(url.searchParams.get('page'));
    assert.equal(url.searchParams.get('limit'), '10');
    assert.equal(options.headers.Authorization, 'Bearer token');
    if (url.searchParams.get('q')) return { videos: [{ id: 'filtered', title: 'Filtered video' }], total: 1 };
    if (url.pathname.startsWith('/api/videos/search')) return { videos: [{ id: 'public', title: 'Public video', uploader_name: 'Another owner' }], pagination: { total: 1 } };
    if (page === 2 && failNext) throw new Error('Temporary failure');
    return { videos: Array.from({ length: page === 1 ? 10 : 1 }, (_, i) => ({ id: `v${(page - 1) * 10 + i}`, title: `Video ${(page - 1) * 10 + i}`, visibility: 'private' })), total: 11 };
  }
  const load = modules({
    '~/functions': { getToken: () => 'token' }, '~/constants': { AddSVG: '+', CheckSVG: '✓' }, '~/i18n': { useI18n: () => ({ t: key => key }) },
    '~/authorization/authorization': { useAuthorization: () => ({ user: { full_name: 'Owner' }, can: () => allowMine }) },
    '~/API': { fetchFn: request }, '~/videoDiscovery': { fetchVectorVideos: request },
    '~/components/shared/videoMedia': { getVideoThumbnail: () => '/cover.webp' },
    '~/components/customSelect/customSelect': { __esModule: true, default: ({ value, onChange, options }) => React.createElement('select', { value, onChange: e => onChange(e.target.value) }, options.map(o => React.createElement('option', { key: o.value, value: o.value }, o.label))) },
  });
  const Picker = load('../editPlaylistPage/PlaylistVideoPicker.tsx').default;
  function Harness() {
    const [included, setIncluded] = React.useState(['v0']);
    return React.createElement(Picker, { included, busy: false, addingId: null, onAdd: video => { added.push(video); setIncluded(ids => [...ids, video.id]); } });
  }
  const render = () => root.render(React.createElement(QueryClientProvider, { client }, React.createElement(Harness)));
  const settle = async () => { for (let i = 0; i < 3; i++) await act(async () => { await new Promise(r => setTimeout(r, 10)); }); };
  const click = async el => { await act(async () => el.click()); await settle(); };
  await act(async () => render()); await settle();
  assert.equal(document.querySelectorAll('.playlistVideoSearchRow').length, 10);
  assert.equal(document.querySelector('button[aria-label="playlistVideoAdded: Video 0"]').disabled, true);
  await click(document.querySelector('button[aria-label="addVideo: Video 1"]'));
  assert.equal(added[0].uploader_name, 'Owner'); assert.deepEqual(added[0].people, []);
  assert.equal(document.querySelector('button[aria-label="playlistVideoAdded: Video 1"]').disabled, true);
  await act(async () => intersect()); await settle();
  assert.equal(document.querySelectorAll('.playlistVideoSearchRow').length, 10); assert.ok(document.querySelector('[role="alert"]'));
  failNext = false;
  await click([...document.querySelectorAll('button')].find(b => b.textContent === 'usersRetry'));
  assert.equal(document.querySelectorAll('.playlistVideoSearchRow').length, 11); assert.equal(intersect, null);
  const select = document.querySelector('select');
  await act(async () => { select.value = 'public'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }); await settle();
  assert.equal(document.querySelectorAll('.playlistVideoSearchRow').length, 1); assert.match(document.body.textContent, /Public video/);
  const input = document.querySelector('input[role="searchbox"]');
  await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, ' filtered '); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
  await act(async () => { await new Promise(r => setTimeout(r, 320)); }); await settle();
  assert.match(requests.at(-1).route, /q=filtered/);
  await click(document.querySelector('button[aria-label="addVideo: Filtered video"]'));
  assert.equal(input.value, ' filtered '); assert.equal(document.querySelector('button[aria-label="playlistVideoAdded: Filtered video"]').disabled, true);
  allowMine = false; await act(async () => render()); assert.equal(document.querySelector('select'), null);
});
