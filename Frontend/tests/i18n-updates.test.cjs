const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { JSDOM } = require('jsdom');
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');

function loadModules() {
  const cache = new Map();
  const project = path.resolve(__dirname, '..');
  const mocks = {
    '~/changeables': { BRAND_NAME: 'Test', PLATFORM_NAME: 'Video', POWERED_BY_NAME: 'Test' },
    '~/components/shared/videoMedia': { getVideoThumbnail: () => undefined },
    'react-router': { Link: ({ to, children, ...props }) => React.createElement('a', { ...props, href: to }, children) },
  };
  function load(file) {
    file = path.resolve(project, file);
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.ts');
    if (!path.extname(file)) file += fs.existsSync(file + '.ts') ? '.ts' : '.tsx';
    if (file.endsWith('.json')) return JSON.parse(fs.readFileSync(file, 'utf8'));
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    const localRequire = name => {
      if (mocks[name]) return mocks[name];
      if (name.startsWith('~/')) return load(path.join(project, 'app', name.slice(2)));
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name));
      return require(name);
    };
    new Function('require', 'module', 'exports', code)(localRequire, mod, mod.exports);
    return mod.exports;
  }
  return load;
}

test('memoized video and playlist metadata follow language changes in this tab and other tabs', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://app.example/' });
  const descriptors = new Map();
  for (const key of ['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'IS_REACT_ACT_ENVIRONMENT']) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[key] });
  }
  let root;
  t.after(async () => {
    if (root) await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  localStorage.setItem('platformLanguage', 'en');
  const load = loadModules();
  const { I18nProvider, useI18n } = load('app/i18n.tsx');
  const { formatTranslation } = load('app/locales/formatTranslation.ts');
  const PlayCard = load('app/components/playPage/playerCollection/playCard.tsx').default;
  const PlaylistInfo = load('app/components/playlistInfo.tsx').default;
  const date = '2025-10-10T12:00:00Z';
  const videos = [346, 121].map((view_count, index) => ({ id: `video-${index}`, title: 'Session', people: [], view_count, created_at: date, duration_seconds: 120, percentage_watched: 0, progress_seconds: 0 }));
  const playlist = { title: 'Collection', views: 95, date };
  let switchLocale;
  function Controls() {
    const { t, setLocale } = useI18n(); switchLocale = setLocale;
    return React.createElement('h1', null, t('channelLabel'));
  }
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(I18nProvider, null,
    React.createElement(Controls),
    ...videos.map(video => React.createElement(PlayCard, { key: video.id, props: video, playedVideoId: '', playlistId: '' })),
    React.createElement(PlaylistInfo, { props: playlist }),
  )));
  function assertLanguage(locale) {
    assert.equal(document.querySelector('h1').textContent, formatTranslation(locale, 'channelLabel'));
    const intlLocale = locale === 'sr' ? 'sr-Latn-RS' : locale;
    const expectedDate = new Intl.DateTimeFormat(intlLocale, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(date));
    const counts = [...document.querySelectorAll('.playCard b'), document.querySelector('.views')];
    [346, 121, 95].forEach((count, i) => assert.equal(counts[i].textContent, formatTranslation(locale, 'pluralViews', { count: new Intl.NumberFormat(intlLocale).format(count) })));
    assert.equal(document.querySelector('.date').textContent, expectedDate);
    for (const card of document.querySelectorAll('.playCard')) assert.ok(card.textContent.includes(expectedDate));
    assert.equal(document.documentElement.lang, locale);
  }
  assertLanguage('en');
  await act(async () => switchLocale('ru'));
  assertLanguage('ru'); // No prop change, hover, navigation or remount needed.
  await act(async () => {
    localStorage.setItem('platformLanguage', 'sr');
    window.dispatchEvent(new window.StorageEvent('storage', { key: 'platformLanguage', newValue: 'sr', storageArea: localStorage }));
  });
  assertLanguage('sr');
  await act(async () => switchLocale('en'));
  assertLanguage('en');
});
