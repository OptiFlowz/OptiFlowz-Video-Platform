const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { JSDOM } = require('jsdom');

test('re-evaluating the player theme preserves already registered custom elements', t => {
  const { window } = new JSDOM('<!doctype html>');
  t.after(() => window.close());
  const file = path.resolve(__dirname, '../app/components/playPage/playerCollection/optiflowzTheme/dist/media-theme.js');
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const dependencies = {
    'media-chrome': {},
    'media-chrome/dist/menu/index.js': {},
    'media-chrome/dist/utils/server-safe-globals.js': { globalThis: window },
    'media-chrome/dist/media-theme-element.js': {
      MediaThemeElement: class extends window.HTMLElement {},
    },
  };
  const evaluate = () => {
    const module = { exports: {} };
    new Function('require', 'module', 'exports', 'HTMLElement', code)(name => {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected import: ${name}`);
      return dependencies[name];
    }, module, module.exports, window.HTMLElement);
  };
  const names = ['media-theater-mode-button', 'media-current-chapter', 'media-theme-optiflowz-theme'];

  evaluate();
  const initialConstructors = names.map(name => window.customElements.get(name));
  initialConstructors.forEach(constructor => assert.equal(typeof constructor, 'function'));

  // A fresh module execution models hot reload while the browser registry survives.
  assert.doesNotThrow(evaluate);
  assert.doesNotThrow(evaluate);
  names.forEach((name, index) => {
    assert.equal(window.customElements.get(name), initialConstructors[index]);
    assert.ok(window.document.createElement(name) instanceof initialConstructors[index]);
  });
});
