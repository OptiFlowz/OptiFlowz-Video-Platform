const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const app = path.resolve(__dirname, '../app');
const directory = path.join(app, 'locales');
const files = fs.readdirSync(directory).filter(name => name.endsWith('.json'));
const catalogues = Object.fromEntries(files.map(name => [name.slice(0, -5), JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'))]));
const base = catalogues.en;

function strings(entry) {
  return typeof entry === 'string' ? [entry] : Object.entries(entry).filter(([key]) => !['select', 'rule'].includes(key)).map(([, value]) => value);
}
function parameters(entry) {
  // rawParam and param interpolate the same named argument; only missing-value behavior differs.
  return [...new Set(strings(entry).flatMap(value => [...value.matchAll(/\{\{(?:rawParam|param)\.(\w+)\}\}/g)].map(match => match[1])))].sort();
}

test('every supported locale has complete, nonempty messages and no duplicate keys', () => {
  const registry = fs.readFileSync(path.join(directory, 'index.ts'), 'utf8');
  const registered = [...new Set([...registry.matchAll(/['"]\.\/([a-z]+)\.json['"]/g)].map(match => match[1]))].sort();
  assert.deepEqual(Object.keys(catalogues).sort(), registered);
  for (const [locale, catalogue] of Object.entries(catalogues)) {
    for (const [key, entry] of Object.entries(base)) {
      assert.ok(Object.hasOwn(catalogue, key), `${locale}: missing ${key}`);
      const translated = catalogue[key];
      // Locales may use a single string where English needs plural forms.
      assert.ok(typeof translated === 'string' || (translated && typeof translated === 'object' && !Array.isArray(translated)), `${locale}.${key}: message shape`);
      if (typeof translated === 'object') {
        if (typeof entry === 'object') assert.equal(translated.select, entry.select, `${locale}.${key}: plural selector`);
        else assert.ok(parameters(entry).includes(translated.select), `${locale}.${key}: unknown plural selector`);
        assert.ok(translated.one && translated.other, `${locale}.${key}: missing plural forms`);
      }
      for (const value of strings(translated)) assert.ok(typeof value === 'string' && value.trim(), `${locale}.${key}: empty translation`);
    }
    const source = ts.parseJsonText(`${locale}.json`, fs.readFileSync(path.join(directory, `${locale}.json`), 'utf8'));
    function walk(node) {
      if (ts.isObjectLiteralExpression(node)) {
        const names = node.properties.map(property => property.name.text);
        assert.equal(new Set(names).size, names.length, `${locale}: duplicate JSON key`);
      }
      ts.forEachChild(node, walk);
    }
    walk(source);
  }
});

test('translations retain interpolation arguments and valid placeholder syntax', () => {
  for (const [locale, catalogue] of Object.entries(catalogues)) {
    for (const [key, entry] of Object.entries(base)) {
      assert.deepEqual(parameters(catalogue[key]), parameters(entry), `${locale}.${key}: interpolation arguments`);
      for (const value of strings(catalogue[key])) {
        const remaining = value.replace(/\{\{(?:brand|param|rawParam)\.[\w]+\}\}/g, '');
        assert.ok(!remaining.includes('{{') && !remaining.includes('}}'), `${locale}.${key}: malformed placeholder`);
      }
    }
  }
});

test('literal translation keys used by the app exist in the base catalogue', () => {
  function literals(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
    if (ts.isConditionalExpression(node)) return [...literals(node.whenTrue), ...literals(node.whenFalse)];
    return [];
  }
  function scan(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== 'locales') scan(file); continue; }
      if (!/\.tsx?$/.test(file)) continue;
      const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      function walk(node) {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ['t', 'translate'].includes(node.expression.text) && node.arguments[0]) {
          for (const key of literals(node.arguments[0])) assert.ok(Object.hasOwn(base, key), `${path.relative(app, file)}: unknown translation ${key}`);
        }
        ts.forEachChild(node, walk);
      }
      walk(source);
    }
  }
  scan(app);
});
