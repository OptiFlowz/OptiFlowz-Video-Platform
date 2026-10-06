const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { JSDOM } = require('jsdom');

const translate = key => key;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

async function mountPage(page) {
  const dom = new JSDOM('<div id="root"></div>', { url: `https://example.test/${page}` });
  const navigations = [];
  const googleAttempts = [];
  const location = { origin: dom.window.location.origin, assign: url => navigations.push(url) };
  const browserWindow = new Proxy(dom.window, {
    get(target, key) {
      if (key === 'location') return location;
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const globals = ['window', 'document', 'HTMLElement', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(globals.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.assign(globalThis, {
    window: browserWindow, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true,
  });
  const timers = new Map();
  let timerId = 0;
  dom.window.setTimeout = callback => { timers.set(++timerId, callback); return timerId; };
  dom.window.clearTimeout = id => timers.delete(id);
  let closingAnimations = [];
  dom.window.HTMLElement.prototype.getAnimations = function (options) {
    assert.equal(options.subtree, true);
    assert.equal(this.classList.contains('active'), false);
    return closingAnimations.map(animation => ({ finished: animation.promise }));
  };
  const requests = [];
  const searchParams = new URLSearchParams();
  const navigate = () => {};
  const mocks = {
    'react-router': {
      Link: ({ to, children, ...props }) => React.createElement('a', { href: to, ...props }, children),
      useNavigate: () => navigate, useSearchParams: () => [searchParams],
    },
    '~/i18n': { useI18n: () => ({ t: translate }) },
    '~/constants': { LogoSVG: null, ArrowForwardSVG: null, passwordHideSVG: null, passwordShowSVG: null },
    '~/changeables': { LOGO: '/logo.webp', BRAND_NAME: 'OptiFlowz', MARKETING_WEBSITE_URL: 'https://example.test', LOGIN_BACKGROUND_IMAGE: '/background.webp' },
    '~/functions': { changeElementClass() {}, getStoredUser: () => null },
    '~/context': { CurrentNavContext: React.createContext({ setCurrentNav() {} }) },
    '~/auth/session': { saveSession() {} },
    '~/auth/safeRedirect': { safeRedirect: () => '/' },
    '~/auth/twoFactor': { isTwoFactorChallenge: () => false },
    '~/env': { env: { googleClientId: 'google-client-id' } },
    '~/auth/googleOAuth': { startGoogleAttempt: (redirect, remember) => {
      googleAttempts.push({ redirect, remember });
      return `oauth-state-${googleAttempts.length}`;
    } },
    '~/API': { fetchFn: request => {
      const response = deferred();
      requests.push({ ...request, response });
      return response.promise;
    } },
    '../loaders/loader': { __esModule: true, default: () => null },
    './twoFactorLoginForm': { __esModule: true, default: () => null },
  };
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
      if (name.endsWith('.webp')) return '/image.webp';
      if (name.startsWith('~/')) return load(path.resolve(__dirname, '../app', name.slice(2)));
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name));
      return require(name);
    }, mod, mod.exports);
    return mod.exports;
  }
  const Page = load(path.resolve(__dirname, `../app/components/${page}Page/${page}Page.tsx`)).default;
  const { createRoot } = require('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  await React.act(async () => root.render(React.createElement(Page)));
  const button = text => [...document.querySelectorAll('button')].find(item => item.textContent === text);
  const enter = (target, repeat = false) => target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', repeat, bubbles: true, cancelable: true }));
  return {
    requests, timers, button, enter, navigations, googleAttempts,
    popup: () => document.querySelector('.popup'),
    async closePopup(auto = false, animated = true) {
      closingAnimations = animated ? [deferred(), deferred()] : [];
      await React.act(async () => {
        if (auto) [...timers.values()][0]();
        else dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
      });
      return closingAnimations;
    },
    async cleanup() {
      await React.act(async () => root.unmount());
      dom.window.close();
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    },
  };
}

test('login blocks rapid Enter and clicks through validation, requests, auto-close and both exit transitions', async () => {
  const page = await mountPage('login');
  try {
    const email = document.querySelector('input[type="email"]');
    const password = document.querySelector('input[type="password"]');
    const submit = page.button('logIn');
    await React.act(async () => { for (let i = 0; i < 10; i++) page.enter(password); });
    assert.equal(page.popup().textContent, 'pleaseEnterEmailPassword');
    assert.equal(submit.disabled, true);
    email.value = 'user@example.test';
    password.value = 'password123';
    const originalTimer = [...page.timers.keys()][0];
    await React.act(async () => {
      page.enter(password);
      submit.click();
      document.querySelector('.passwordInput button').click();
    });
    assert.equal(page.requests.length, 0);
    assert.deepEqual([...page.timers.keys()], [originalTimer], 'Editing the form must not restart the message timer');
    const animations = await page.closePopup(true);
    assert.equal(page.popup().classList.contains('active'), false);
    await React.act(async () => { page.enter(password); submit.click(); });
    assert.equal(page.requests.length, 0);
    await React.act(async () => animations[0].resolve());
    assert.equal(submit.disabled, true, 'Wait for the panel as well as the backdrop');
    await React.act(async () => animations[1].resolve());
    assert.equal(submit.disabled, false);
    await React.act(async () => page.enter(password, true));
    assert.equal(page.requests.length, 0, 'Held-down Enter must not retry after feedback closes');
    await React.act(async () => { for (let i = 0; i < 10; i++) page.enter(password); submit.click(); });
    assert.equal(page.requests.length, 1);
    await React.act(async () => page.requests[0].response.reject({ status: 401 }));
    assert.equal(page.popup().textContent, 'passwordIncorrect');
    await React.act(async () => { page.enter(password); submit.click(); });
    assert.equal(page.requests.length, 1, 'A settled request remains blocked by its server message');
    const serverExit = await page.closePopup();
    await React.act(async () => page.enter(password));
    assert.equal(page.requests.length, 1);
    await React.act(async () => serverExit.forEach(animation => animation.resolve()));
    await React.act(async () => submit.click());
    assert.equal(page.requests.length, 2, 'A new submission is allowed after the message has fully closed');
  } finally { await page.cleanup(); }
});

test('registration locks both steps, reads current consent for Enter, and permits retry after server feedback', async () => {
  const page = await mountPage('register');
  try {
    const next = page.button('next');
    await React.act(async () => { for (let i = 0; i < 10; i++) page.enter(window); });
    assert.equal(page.popup().textContent, 'completeRequiredFields');
    assert.equal(next.disabled, true);
    const inputs = [...document.querySelectorAll('.inputHolder input'), document.querySelector('input[placeholder="emailAddress"]'), document.querySelector('input[type="password"]')];
    ['Test', 'User', 'user@example.test', 'password123'].forEach((value, index) => { inputs[index].value = value; });
    await React.act(async () => { page.enter(inputs[0]); next.click(); });
    assert.equal(page.button('finish'), undefined);
    const localExit = await page.closePopup();
    await React.act(async () => page.enter(inputs[0]));
    assert.equal(page.button('finish'), undefined);
    await React.act(async () => localExit.forEach(animation => animation.resolve()));
    await React.act(async () => next.click());
    const finish = page.button('finish');
    await React.act(async () => page.enter(window));
    assert.equal(page.popup().textContent, 'registrationLegalRequired');
    const consent = document.getElementById('legalAcceptance');
    await React.act(async () => consent.click());
    await React.act(async () => { page.enter(window); finish.click(); });
    assert.equal(page.requests.length, 0);
    await page.closePopup(false, false);
    assert.equal(finish.disabled, false, 'No-animation/reduced-motion closure must also unlock');
    await React.act(async () => page.enter(window, true));
    assert.equal(page.requests.length, 0);
    await React.act(async () => { for (let i = 0; i < 10; i++) page.enter(window); finish.click(); });
    assert.equal(page.requests.length, 1, 'Keyboard submission must use the newly accepted consent');
    assert.equal(page.button('previous').disabled, true);
    await React.act(async () => page.requests[0].response.reject({ status: 409 }));
    assert.equal(page.popup().textContent, 'accountExists');
    await React.act(async () => { page.enter(window); finish.click(); });
    assert.equal(page.requests.length, 1);
    const serverExit = await page.closePopup();
    await React.act(async () => page.enter(window));
    assert.equal(page.requests.length, 1);
    await React.act(async () => serverExit.forEach(animation => animation.resolve()));
    await React.act(async () => page.enter(window));
    assert.equal(page.requests.length, 2);
  } finally { await page.cleanup(); }
});

test('only the selected login button changes text and Google login can retry after a cached-page return', async () => {
  const page = await mountPage('login');
  try {
    const email = document.querySelector('input[type="email"]');
    const password = document.querySelector('input[type="password"]');
    const credentials = page.button('logIn');
    const google = page.button('continueWithGoogle');
    email.value = 'user@example.test';
    password.value = 'password123';
    await React.act(async () => credentials.click());
    assert.equal(credentials.textContent, 'loggingIn');
    assert.equal(google.textContent, 'continueWithGoogle');
    assert.equal(google.disabled, true, 'Keep concurrent submissions blocked without changing the other label');
    await React.act(async () => google.click());
    assert.equal(page.googleAttempts.length, 0);
    await React.act(async () => page.requests[0].response.reject({ status: 401 }));
    assert.equal(credentials.textContent, 'logIn');
    assert.equal(google.textContent, 'continueWithGoogle');
    assert.equal(google.disabled, true, 'The feedback lock still applies to Google login');
    await page.closePopup(false, false);
    await React.act(async () => { for (let i = 0; i < 10; i++) google.click(); });
    assert.equal(google.textContent, 'loggingIn');
    assert.equal(google.disabled, true);
    assert.equal(credentials.textContent, 'logIn');
    assert.equal(page.googleAttempts.length, 1);
    const destination = new URL(page.navigations[0]);
    assert.equal(destination.origin, 'https://accounts.google.com');
    assert.equal(destination.searchParams.get('state'), 'oauth-state-1');
    assert.equal(destination.searchParams.get('redirect_uri'), 'https://example.test/google-callback');
    await React.act(async () => window.dispatchEvent(new window.PageTransitionEvent('pageshow', { persisted: true })));
    assert.equal(google.disabled, false);
    assert.equal(google.textContent, 'continueWithGoogle');
    await React.act(async () => google.click());
    assert.equal(page.navigations.length, 2);
    assert.equal(new URL(page.navigations[1]).searchParams.get('state'), 'oauth-state-2', 'Retry creates a fresh OAuth attempt');
    await React.act(async () => window.dispatchEvent(new window.PageTransitionEvent('pageshow', { persisted: false })));
    assert.equal(google.disabled, false);
    assert.equal(google.textContent, 'continueWithGoogle');
  } finally { await page.cleanup(); }
});
