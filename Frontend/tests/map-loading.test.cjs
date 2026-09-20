const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { createRoot } = require('react-dom/client');
const { JSDOM } = require('jsdom');
const { act } = React;

function loadMapComponents(mapDownload) {
  const cache = new Map();
  const mocks = {
    react: { ...React, lazy: load => React.lazy(() => mapDownload.then(load)) },
    '~/constants': { ArrowSVG: null, CloseSVG: null },
    '~/i18n': { useI18n: () => ({ t: key => key }) },
    '@svg-maps/world': { __esModule: true, default: { viewBox: '0 0 100 100', label: 'World', locations: [{ id: 'rs', name: 'Serbia', path: 'M0 0h10v10Z' }] } },
  };
  function load(file) {
    if (!path.extname(file)) file += '.tsx';
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    const localRequire = name => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.endsWith('.css')) return {};
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name));
      return require(name);
    };
    new Function('require', 'module', 'exports', source)(localRequire, module, module.exports);
    return module.exports;
  }
  return load(path.resolve(__dirname, '../app/components/analytics/geographicBreakdown.tsx')).default;
}

test('zoom chosen while the map downloads is applied when its SVG mounts', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.test' });
  const previous = new Map();
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'IS_REACT_ACT_ENVIRONMENT']) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[key] });
  }
  Object.defineProperty(dom.window.SVGSVGElement.prototype, 'viewBox', { get: () => ({ baseVal: { x: 0, y: 0, width: 100, height: 100 } }) });
  const frames = new Map();
  let nextFrame = 0;
  window.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
  window.cancelAnimationFrame = id => frames.delete(id);
  const flushFrames = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0)); };
  let finishDownload;
  const download = new Promise(resolve => { finishDownload = resolve; });
  const GeographicBreakdown = loadMapComponents(download);
  const container = document.getElementById('root');
  const root = createRoot(container);
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  await act(async () => root.render(React.createElement(GeographicBreakdown, {
    breakdown: { RS: { name: 'Serbia', totalViews: 4, cities: {} } },
    isLoading: false, isError: false, description: 'Views by country',
  })));
  const controls = container.querySelectorAll('.videoAnalyticsMapControls button');
  assert.ok(container.querySelector('svg[aria-busy="true"]'), 'the SVG chunk is still pending');
  await act(async () => { controls[0].click(); controls[0].click(); flushFrames(); });
  assert.equal(container.querySelector('svg g'), null);
  await act(async () => finishDownload());
  const layer = container.querySelector('svg g');
  assert.ok(layer, 'the real SVG has mounted');
  assert.ok(Math.abs(Number(layer.getAttribute('transform')?.match(/scale\(([^)]+)\)/)?.[1]) - 1.7) < 0.00001, 'latest zoom is restored without another interaction');
  await act(async () => { controls[1].click(); flushFrames(); });
  assert.match(layer.getAttribute('transform'), /scale\(1\)/, 'normal controls still work after the chunk resolves');
});
