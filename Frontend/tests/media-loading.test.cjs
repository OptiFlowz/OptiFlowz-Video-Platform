const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { JSDOM } = require('jsdom');
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');

function setup(t) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://app.example/' });
  const previous = new Map();
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT']) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value: name === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[name] });
  }
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(() => root.unmount()); dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
  });
  const mocks = {
    '../live/LiveStatus': { __esModule: true, default: () => null },
    '~/constants': { LockSVG: React.createElement('svg') },
    '~/components/shared/videoMedia': { getVideoThumbnail: video => video.thumbnail_url },
    'react-router': { Link: ({ to, children, ...props }) => React.createElement('a', { href: to, ...props }, children) },
    '~/components/contentInfo': { __esModule: true, default: () => null },
    '~/functions': { formatDuration: () => '1:00' },
    '~/context': { CurrentNavContext: React.createContext({ setCurrentNav() {} }) },
    '~/i18n': { useI18n: () => ({ t: key => require('../app/locales/en.json')[key] ?? key }) },
    'next/image': { __esModule: true, default: ({ fill, ...props }) => React.createElement('img', props) },
  };
  function load(relative, named = false) {
    const file = path.join(__dirname, '..', relative);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)(name => {
      if (mocks[name]) return mocks[name];
      if (name.startsWith('~/')) {
        const relativePath = 'app/' + name.slice(2);
        return load(relativePath + (fs.existsSync(path.join(__dirname, '..', relativePath + '.ts')) ? '.ts' : '.tsx'), true);
      }
      if (name.endsWith('.css')) return {};
      if (name.endsWith('.webp')) return { __esModule: true, default: name };
      return require(name);
    }, module, module.exports);
    return named ? module.exports : module.exports.default;
  }
  return { root, load };
}

for (const vertical of [false, true]) {
  test(`${vertical ? 'vertical' : 'collection'} role-locked card keeps its banner, with no preview or watch link`, async t => {
    const { root, load } = setup(t);
    const Item = load(vertical ? 'app/components/searchPage/verticalSlider/item.tsx' : 'app/components/itemSlider/item.tsx');
    const props = { id: 'restricted', title: 'Members video', duration: 60, duration_seconds: 60,
      thumbnail: '/banner.webp', thumbnail_url: '/banner.webp', preview_url: '/unused.webp',
      audience_mode: 'selected_roles', can_watch: false };
    await act(() => root.render(React.createElement(Item, { props })));
    const banner = document.querySelector('[data-locked-banner="true"]');
    assert.ok(banner.querySelector('svg'));
    assert.equal(banner.querySelector('.duration'), null);
    assert.equal(banner.querySelector('small').textContent, 'Insufficient permissions');
    assert.equal(banner.querySelector('img').getAttribute('src'), '/banner.webp');
    await act(() => banner.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true })));
    assert.equal(document.querySelector('img[src="/unused.webp"], a'), null);
    await act(() => root.render(React.createElement(Item, { props: { ...props, can_watch: true } })));
    assert.ok(document.querySelector('a[href="/video/restricted"]'));
    assert.equal(document.querySelector('.duration').textContent, '1:00');
    assert.equal(document.querySelector('.videoLockOverlay'), null);
  });

  test(`${vertical ? 'vertical' : 'collection'} card requests signed preview only after pointer/focus intent`, async t => {
    const { root, load } = setup(t);
    const Item = load(vertical ? 'app/components/searchPage/verticalSlider/item.tsx' : 'app/components/itemSlider/item.tsx');
    const signedPreview = 'https://image.mux.com/video/animated.webp?token=keep-exact-signature';
    await act(() => root.render(React.createElement(Item, { props: {
      id: 'video', title: 'Test', duration: 60, duration_seconds: 60,
      thumbnail: '/thumbnail.webp', thumbnail_url: '/thumbnail.webp', preview_url: signedPreview,
      percentage_watched: 0, progress_seconds: 0,
    } })));
    const thumbnail = document.querySelector('img[alt="Thumbnail"]');
    assert.equal(thumbnail.getAttribute('loading'), 'lazy');
    await act(() => thumbnail.dispatchEvent(new window.Event('load')));
    assert.equal(document.querySelector('img[alt="Thumbnail preview"]'), null);
    await act(() => document.querySelector('a').dispatchEvent(new window.FocusEvent('focusin', { bubbles: true })));
    assert.equal(document.querySelector('img[alt="Thumbnail preview"]').getAttribute('src'), signedPreview);
    await act(() => document.querySelector('a').dispatchEvent(new window.FocusEvent('focusout', { bubbles: true })));
    assert.equal(document.querySelectorAll('img[alt="Thumbnail preview"]').length, 1);
  });
}

const bannerFile = path.join(__dirname, '../app/components/homePage/HomeBanner.tsx');
if (fs.existsSync(bannerFile)) {
  test('hero initially requests one responsive image and keeps it visible until a selected image loads', async t => {
    const { root, load } = setup(t);
    const Hero = load('app/components/homePage/HomeBanner.tsx');
    await act(() => root.render(React.createElement(Hero)));
    assert.equal(document.querySelectorAll('.homeBannerArtwork img').length, 1);
    const first = document.querySelector('img');
    assert.ok(first.getAttribute('sizes').includes('100vw'));
    await act(() => first.dispatchEvent(new window.Event('load')));
    await act(() => document.querySelectorAll('button')[2].click());
    assert.equal(document.querySelectorAll('.homeBannerArtwork img').length, 2);
    assert.equal(first.className, 'isSelected');
    const next = document.querySelectorAll('.homeBannerArtwork img')[1];
    await act(() => next.dispatchEvent(new window.Event('load')));
    assert.equal(next.className, 'isSelected');
    assert.notEqual(first.className, 'isSelected');
  });
}
