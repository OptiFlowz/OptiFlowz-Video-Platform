const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { JSDOM } = require('jsdom');

test('nested quiz editors keep the page locked and restore its scroll position and styles', t => {
  const dom = new JSDOM('<html style="overflow: auto; scroll-behavior: smooth"><body style="position: relative; overflow: clip; width: 90%"></body></html>');
  const previous = { window: global.window, document: global.document };
  global.window = dom.window;
  global.document = dom.window.document;
  t.after(() => { Object.assign(global, previous); dom.window.close(); });
  Object.defineProperties(window, { scrollX: { value: 12 }, scrollY: { value: 360 } });
  const restored = [];
  window.scrollTo = (x, y) => restored.push([x, y, document.documentElement.style.scrollBehavior]);
  const compiled = ts.transpileModule(fs.readFileSync('app/components/quizEngine/scrollLock.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const loaded = { exports: {} };
  new Function('module', 'exports', compiled)(loaded, loaded.exports);
  const { lockEditorPageScroll } = loaded.exports;
  const outer = lockEditorPageScroll(), inner = lockEditorPageScroll();
  assert.equal(document.documentElement.style.overflow, 'hidden');
  assert.equal(document.body.style.position, 'fixed');
  assert.equal(document.body.style.top, '-360px');
  inner();
  inner(); // Releasing the same popup twice must not release another popup's lock.
  assert.equal(document.documentElement.style.overflow, 'hidden');
  assert.deepEqual(restored, []);
  outer();
  assert.equal(document.documentElement.style.overflow, 'auto');
  assert.equal(document.documentElement.style.scrollBehavior, 'smooth');
  assert.equal(document.body.style.position, 'relative');
  assert.equal(document.body.style.overflow, 'clip');
  assert.equal(document.body.style.width, '90%');
  assert.equal(document.body.style.top, '');
  assert.deepEqual(restored, [[12, 360, 'auto']]);

  // Unmounting a parent first also keeps the nested popup locked.
  const parent = lockEditorPageScroll(), child = lockEditorPageScroll();
  parent();
  assert.equal(document.documentElement.style.overflow, 'hidden');
  child();
  assert.equal(document.documentElement.style.overflow, 'auto');
});
