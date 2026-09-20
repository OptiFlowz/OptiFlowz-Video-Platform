const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToString } = require('react-dom/server');
const { createRoot, hydrateRoot } = require('react-dom/client');
const { JSDOM } = require('jsdom');
const project = path.resolve(__dirname, '..');
const { act } = React;

function modules(overrides = {}) {
  const cache = new Map();
  const queryClients = [];
  const query = require('@tanstack/react-query');
  const navigation = [];
  const location = { pathname: '/', search: '', hash: '' };
  const Link = ({ to, children, className, end, ...props }) => React.createElement('a', { ...props, href: to, className: typeof className === 'function' ? className({ isActive: to === '/' }) : className }, typeof children === 'function' ? children({ isActive: to === '/' }) : children);
  const mocks = {
    '@tanstack/react-query': { ...query, QueryClient: class extends query.QueryClient { constructor(...args) { super(...args); queryClients.push(this); } } },
    '~/env': { env: { apiBaseUrl: 'https://api.example', siteUrl: 'https://app.example' } },
    './env': { env: { apiBaseUrl: 'https://api.example', siteUrl: 'https://app.example' } },
    '~/changeables': { BRAND_NAME: 'Test', PLATFORM_NAME: 'Video', POWERED_BY_NAME: 'Test', LOGO: '/logo.webp', MARKETING_WEBSITE_URL: 'https://example.com' },
    'react-router': { Link, NavLink: Link, useLocation: () => location, useNavigate: () => to => navigation.push(to), useNavigation: () => ({ state: 'idle' }), useSearchParams: () => [new URLSearchParams()], useParams: () => ({}) },
    'next/navigation': { usePathname: () => location.pathname, useRouter: () => ({ replace: to => navigation.push(to) }) },
    'next/dynamic': { default: () => () => null },
    ...overrides,
  };
  function load(file) {
    file = path.resolve(project, file);
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.ts');
    if (!path.extname(file)) file += fs.existsSync(file + '.ts') ? '.ts' : '.tsx';
    if (file.endsWith('.json')) return JSON.parse(fs.readFileSync(file, 'utf8'));
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    const localRequire = name => {
      if (Object.hasOwn(mocks, name)) return { __esModule: true, ...mocks[name] };
      if (/\.(css|webp|png|svg)$/.test(name)) return { __esModule: true, default: '/test-asset.webp' };
      if (name.startsWith('~/')) return load(path.join(project, 'app', name.slice(2)));
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name));
      return require(name);
    };
    new Function('require', 'module', 'exports', code)(localRequire, module, module.exports);
    return module.exports;
  }
  return { load, navigation, dispose: () => queryClients.forEach(client => client.clear()) };
}

function dom(t, html = '') {
  const instance = new JSDOM(`<html lang="en"><body><div id="root">${html}</div></body></html>`, { url: 'https://app.example/' });
  const previous = new Map();
  for (const key of ['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'Event', 'StorageEvent', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT']) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : instance.window[key] });
  }
  const container = document.getElementById('root');
  t.after(async () => {
    if (container.root) await act(async () => container.root.unmount());
    instance.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  return container;
}
const flush = () => act(() => new Promise(resolve => setTimeout(resolve, 15)));

// Uses the real providers, header, hero and collections. No DOM or backend is required.
test('public home renders header, hero and collection placeholders into the initial HTML', () => {
  const { load, dispose } = modules();
  const Providers = load('app/providers.tsx').default;
  const Header = load('app/components/header/header.tsx').default;
  const Home = load('app/components/homePage/homePage.tsx').default;
  const html = renderToString(React.createElement(Providers, null, React.createElement(Header), React.createElement(Home)));
  assert.match(html, /<header/);
  assert.match(html, /homePage/);
  assert.match(html, /hero|homeBanner/);
  assert.match(html, /skeleton-item/);
  assert.doesNotMatch(html, /Recommended for you/);
  dispose();
});

test('only requested catalogues load and missing translations keep the English fallback', async () => {
  const { load } = modules();
  const locales = load('app/locales');
  const { formatTranslation } = load('app/locales/formatTranslation.ts');
  assert.deepEqual(Object.keys(locales.catalogues), ['en']);
  assert.equal(formatTranslation('ru', 'channelLabel'), formatTranslation('en', 'channelLabel'));
  const first = locales.loadCatalogue('ru');
  assert.equal(locales.loadCatalogue('ru'), first, 'concurrent requests reuse the same download');
  await first;
  assert.deepEqual(Object.keys(locales.catalogues).sort(), ['en', 'ru']);
  assert.notEqual(formatTranslation('ru', 'channelLabel'), formatTranslation('en', 'channelLabel'));
  assert.equal(formatTranslation('ru', 'unknown.test.key'), 'unknown.test.key');
});

test('language changes resolve in selection order, retain a usable language on failure and retry', async t => {
  const container = dom(t);
  const { load } = modules();
  const locales = load('app/locales');
  const requests = new Map();
  const originalLoad = locales.loadCatalogue;
  locales.loadCatalogue = locale => locale === 'en' ? originalLoad(locale) : new Promise((resolve, reject) => requests.set(locale, { resolve: async () => { await originalLoad(locale); resolve(); }, reject }));
  const { I18nProvider, useI18n, getCurrentLocale } = load('app/i18n.tsx');
  let controls;
  function View() { controls = useI18n(); return React.createElement('p', null, `${controls.locale}:${controls.t('channelLabel')}`); }
  container.root = createRoot(container);
  await act(async () => container.root.render(React.createElement(I18nProvider, null, React.createElement(View))));
  await act(async () => { controls.setLocale('ru'); controls.setLocale('sr'); });
  await act(async () => requests.get('sr').resolve());
  assert.equal(getCurrentLocale(), 'sr');
  assert.equal(document.documentElement.lang, 'sr');
  await act(async () => requests.get('ru').resolve());
  assert.match(container.textContent, /^sr:/);
  assert.equal(localStorage.getItem('platformLanguage'), 'sr');
  await act(async () => controls.setLocale('de'));
  await act(async () => requests.get('de').reject(new Error('offline')));
  assert.match(container.textContent, /^sr:/);
  await act(async () => controls.setLocale('de'));
  await act(async () => requests.get('de').resolve());
  assert.match(container.textContent, /^de:/);
  await act(async () => {
    controls.setLocale('fr');
    localStorage.setItem('platformLanguage', 'ru');
    window.dispatchEvent(new StorageEvent('storage', { key: 'platformLanguage', storageArea: localStorage }));
  });
  await act(async () => requests.get('ru').resolve());
  await act(async () => requests.get('fr').resolve());
  assert.match(container.textContent, /^ru:/);
  assert.equal(localStorage.getItem('platformLanguage'), 'ru', 'late local completion must not overwrite another tab');
});

test('saved non-English language hydrates the English HTML without a mismatch', async t => {
  const server = modules().load;
  const ServerI18n = server('app/i18n.tsx');
  function ServerView() { return React.createElement('h1', null, ServerI18n.useI18n().t('channelLabel')); }
  const html = renderToString(React.createElement(ServerI18n.I18nProvider, null, React.createElement(ServerView)));
  const container = dom(t, html);
  localStorage.setItem('platformLanguage', 'sr');
  const client = modules().load;
  const ClientI18n = client('app/i18n.tsx');
  function ClientView() { return React.createElement('h1', null, ClientI18n.useI18n().t('channelLabel')); }
  const errors = [];
  await act(async () => { container.root = hydrateRoot(container, React.createElement(ClientI18n.I18nProvider, null, React.createElement(ClientView)), { onRecoverableError: error => errors.push(error) }); });
  assert.deepEqual(errors, []);
  assert.equal(document.documentElement.lang, 'sr');
  assert.notEqual(container.innerHTML, html);
});

test('protected content waits for hydration and current permissions without redirecting a stored session', async t => {
  const container = dom(t);
  const responses = [];
  const { load, navigation, dispose } = modules({ '~/API': { fetchFn: request => new Promise(resolve => responses.push({ route: request.route, resolve })) } });
  t.after(dispose);
  const { I18nProvider } = load('app/i18n.tsx');
  const Boundary = load('app/auth/sessionBoundary.tsx').default;
  const { AuthorizationProvider } = load('app/authorization/authorization.tsx');
  const Guard = load('app/client-guard.tsx').default;
  const auth = load('app/auth/session.ts');
  const session = { token: 'private-token', user: { id: 'private-user', full_name: 'Private User', roles: [] } };
  auth.saveSession(session, true);
  const tree = () => React.createElement(Boundary, null, React.createElement(I18nProvider, null, React.createElement(AuthorizationProvider, null,
    React.createElement('h1', null, 'Public shell'), React.createElement(Guard, { mode: 'auth', access: 'videos' }, React.createElement('p', null, 'PRIVATE CONTENT')))));
  const html = renderToString(tree());
  assert.match(html, /Public shell/);
  assert.doesNotMatch(html, /PRIVATE CONTENT/);
  assert.equal(responses.length, 0);
  container.innerHTML = html;
  const errors = [];
  await act(async () => { container.root = hydrateRoot(container, tree(), { onRecoverableError: error => errors.push(error) }); });
  assert.deepEqual(errors, []);
  assert.deepEqual(navigation, [], 'hydration must not send an already signed-in user to login');
  assert.doesNotMatch(container.textContent, /PRIVATE CONTENT/);
  const permission = load('app/authorization/permissions.ts').accessPermissions.videos[0];
  await act(async () => {
    for (const response of responses) response.resolve(response.route === 'api/auth/me' ? { success: true, user: session.user } : { success: true, permissions: [permission] });
  });
  await flush();
  assert.match(container.textContent, /PRIVATE CONTENT/);
  assert.deepEqual(navigation, []);
});
