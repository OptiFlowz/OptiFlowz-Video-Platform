const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const locales = path.join(root, 'app/locales');
const en = JSON.parse(fs.readFileSync(path.join(locales, 'en.json')));

function load(relative, locale = 'en') {
  const messages = JSON.parse(fs.readFileSync(path.join(locales, `${locale}.json`)));
  const code = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  const mockRequire = name => {
    if (name === '~/i18n') return { useI18n: () => ({ t: key => messages[key], locale }) };
    if (name === '~/privacy/privacyPreferences') return { usePrivacyPreferences: () => ({ openPreferences() {} }) };
    if (name === '~/changeables') return { BRAND_NAME: 'OptiFlowz', PLATFORM_NAME: 'Video Platform', LEGAL_ENTITY_NAME: 'OptiFlowz LLC', OFFICE_EMAIL: 'office@example.org', MARKETING_WEBSITE_URL: 'https://example.org' };
    if (name === '~/components/library/LocalizedText') return load('app/components/library/LocalizedText.tsx', locale);
    return require(name);
  };
  new Function('require', 'module', 'exports', code)(mockRequire, mod, mod.exports);
  return mod.exports;
}

function tags(text) {
  return [...text.matchAll(/<(\/?)([a-z][a-z0-9]*)(\/?)>/g)].map(match => match[0]);
}

test('legal translations retain every emphasis, link and value slot with balanced nesting', () => {
  const keys = Object.keys(en).filter(key => /^(privacyPolicy|termsOfUse)\./.test(key));
  for (const file of fs.readdirSync(locales).filter(file => file.endsWith('.json'))) {
    const messages = JSON.parse(fs.readFileSync(path.join(locales, file)));
    for (const key of keys) {
      assert.equal(typeof messages[key], 'string', `${file}: missing ${key}`);
      assert.deepEqual(tags(messages[key]).sort(), tags(en[key]).sort(), `${file}.${key}: altered markup slots`);
      const stack = [];
      for (const token of tags(messages[key])) {
        if (token.endsWith('/>')) continue;
        const name = token.replace(/[<>/]/g, '');
        if (token.startsWith('</')) assert.equal(stack.pop(), name, `${file}.${key}: invalid nesting`);
        else stack.push(name);
      }
      assert.deepEqual(stack, [], `${file}.${key}: unclosed markup`);
    }
  }
});

test('localized rich text reorders links safely and escapes dynamic text', () => {
  const LocalizedText = load('app/components/library/LocalizedText.tsx').default;
  const markup = renderToStaticMarkup(React.createElement(LocalizedText, {
    text: '<link0>Contact <strong>support</strong></link0>: <value1/><br/><script>alert(1)</script>',
    components: { link0: React.createElement('a', { href: 'mailto:help@example.org' }), value1: '<img src=x onerror=alert(1)>' },
  }));
  const dom = new JSDOM(markup);
  assert.equal(dom.window.document.querySelector('a').href, 'mailto:help@example.org');
  assert.equal(dom.window.document.querySelector('strong').textContent, 'support');
  assert.equal(dom.window.document.querySelectorAll('script, img').length, 0);
  assert.ok(dom.window.document.body.textContent.includes('<img src=x onerror=alert(1)>'));
  dom.window.close();
});

test('legal pages switch language while retaining contacts, links, sections and table structure', () => {
  for (const page of ['privacyPolicyPage', 'termsOfUsePage']) {
    const render = locale => {
      const Component = load(`app/components/${page}/${page}.tsx`, locale).default;
      return new JSDOM(renderToStaticMarkup(React.createElement(Component)));
    };
    const english = render('en');
    const links = dom => [...dom.window.document.querySelectorAll('a')].map(a => a.getAttribute('href'));
    for (const locale of ['sr', 'fr', 'ar', 'ja']) {
      const translated = render(locale);
      assert.notEqual(translated.window.document.querySelector('h1').textContent, english.window.document.querySelector('h1').textContent, locale);
      assert.deepEqual(links(translated), links(english));
      for (const selector of ['section', 'h2', 'td', 'li', 'strong', 'br']) {
        assert.equal(translated.window.document.querySelectorAll(selector).length, english.window.document.querySelectorAll(selector).length, `${locale}: ${selector}`);
      }
      assert.doesNotMatch(translated.window.document.body.textContent, /<(?:value|link)\d|\{\{|privacyPolicy\.|termsOfUse\./);
      translated.window.close();
    }
    english.window.close();
  }
});
