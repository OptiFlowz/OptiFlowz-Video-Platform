const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const mod = { exports: {} };
const source = fs.readFileSync(path.join(__dirname, '../app/locales/formatDuration.ts'), 'utf8');
new Function('exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(mod.exports);
const { formatDurationWords } = mod.exports;

test('duration labels retain seconds at minute and hour boundaries', () => {
  for (const [seconds, expected] of [
    [0, '0 seconds'], [1, '1 second'], [30, '30 seconds'], [59, '59 seconds'],
    [60, '1 minute'], [61, '1 minute and 1 second'], [100, '1 minute and 40 seconds'],
    [3600, '1 hour'], [3601, '1 hour and 1 second'], [3661, '1 hour, 1 minute, and 1 second'],
    [4463, '1 hour, 14 minutes, and 23 seconds'], [59.9, '59 seconds'],
  ]) assert.equal(formatDurationWords(seconds, 'en'), expected);
});

test('Serbian uses Latin script, localized units and conjunctions', () => {
  assert.equal(formatDurationWords(100, 'sr'), '1 minut i 40 sekundi');
  assert.equal(formatDurationWords(122, 'sr'), '2 minuta i 2 sekunde');
});
