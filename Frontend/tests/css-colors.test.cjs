const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript');
const mod = { exports: {} };
new Function('require', 'module', 'exports', ts.transpileModule(fs.readFileSync('app/components/cssColorEditor/colors.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(require, mod, mod.exports);
const { colorTokens, toHSV, fromHSV, serializeColor } = mod.exports;

test('CSS colors only annotate declaration values, including nested gradients and modern colors', () => {
  const source = '#fff, .red { --paper: #abcd; color: red; background: linear-gradient(90deg, rgba(1, 2, 3, .4), oklch(60% .2 20)); border: 1px solid blue; content: "#fff red"; /* color: red; */ fill: var(--paper); outline-color: currentColor; box-shadow: 0 0 color-mix(in srgb, red, blue); }';
  const valid = value => /^#|^(?:red|blue)$|^(?:rgba|oklch|color-mix)\(/.test(value);
  const colors = colorTokens(source, valid);
  assert.deepEqual(colors.map(color => color.text), ['#abcd', 'red', 'rgba(1, 2, 3, .4)', 'oklch(60% .2 20)', 'blue', 'color-mix(in srgb, red, blue)']);
  for (const color of colors) assert.equal(source.slice(color.from, color.to), color.text);
  const target = colors[4];
  const edited = source.slice(0, target.from) + '#ffffff' + source.slice(target.to);
  assert.ok(edited.includes('border: 1px solid #ffffff'));
  assert.ok(edited.includes('color-mix(in srgb, red, blue)'));
});
test('HSV roundtrips and picker output retain opacity and RGB/HSL color families', () => {
  for (const color of [{r:0,g:0,b:0,a:1},{r:255,g:255,b:255,a:.4},{r:51,g:140,b:255,a:.5},{r:180,g:20,b:80,a:1}]) {
    const hsv = toHSV(color); assert.deepEqual(fromHSV(hsv.h,hsv.s,hsv.v,color.a), color);
  }
  const color = {r:51,g:140,b:255,a:.5};
  assert.equal(serializeColor(color, '#fff'), '#338cff80');
  assert.equal(serializeColor(color, 'rgba(1,2,3,.5)'), 'rgba(51, 140, 255, 0.5)');
  assert.match(serializeColor(color, 'hsl(0 0% 0%)'), /^hsl\(.+ \/ 0.5\)$/);
  assert.equal(serializeColor({...color,a:1}, 'blue'), '#338cff');
});
