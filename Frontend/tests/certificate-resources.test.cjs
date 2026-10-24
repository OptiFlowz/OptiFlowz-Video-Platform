const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { JSDOM } = require('jsdom');

test('HTML certificate previews support static SVG and fonts without enabling active content', () => {
  const dom = new JSDOM('');
  const mod = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync('app/components/quizEngine/certificatePreview.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const qrModule = { exports: {} };
  const qrSource = ts.transpileModule(fs.readFileSync('app/components/quizEngine/certificateQrPreview.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('exports', qrSource)(qrModule.exports);
  new Function('module', 'exports', 'document', 'window', 'require', source)(mod, mod.exports, dom.window.document, dom.window, () => qrModule.exports);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="blue"><stop offset="0" stop-color="blue"/></linearGradient><clipPath id="clip"><rect width="100" height="100"/></clipPath></defs><path id="mark" d="M0 0L50 50" fill="url(#blue)"/><use href="#mark"/><use href="https://bad.example/icon.svg#mark"/><text>{{user.full_name}}</text><foreignObject><div>unsafe</div></foreignObject><script>bad()</script><animate attributeName="href"/><rect onclick="bad()" /></svg>';
  const embedded = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/><script>bad()</script></svg>');
  const css = '@import url("https://fonts.googleapis.com/css2?family=Roboto");\n@font-face { font-family: Demo; src: url("https://cdn.example/demo.woff2"); }\n@font-face { font-family: Embedded; src: url("data:font/woff2;base64,d09GMg=="); }';
  const html = mod.exports.certificateHtmlDocument({ page_format: 'Letter', orientation: 'landscape', css_template: css,
    html_template: `${svg}<img src="${embedded}"><img src="https://bad.example/image.svg"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto"><link rel="stylesheet" href="https://bad.example/style.css"><iframe src="https://bad.example"></iframe>` });
  const result = new JSDOM(html);
  const doc = result.window.document;
  assert.equal(doc.querySelector('svg').getAttribute('viewBox'), '0 0 100 100');
  assert.ok(doc.querySelector('linearGradient'));
  assert.ok(doc.querySelector('clipPath'));
  assert.equal(doc.querySelector('svg text').textContent, 'John Anderson');
  assert.equal(doc.querySelector('use').getAttribute('href'), '#mark');
  assert.equal(doc.querySelectorAll('use')[1].hasAttribute('href'), false);
  assert.equal(doc.querySelector('script, foreignObject, animate, iframe, [onclick]'), null);
  const image = decodeURIComponent(doc.querySelector('img').getAttribute('src').split(',')[1]);
  assert.match(image, /<path/);
  assert.doesNotMatch(image, /script/);
  assert.equal(doc.querySelectorAll('img')[1].hasAttribute('src'), false);
  assert.equal(doc.querySelectorAll('link').length, 1);
  assert.equal(doc.querySelector('link').crossOrigin, 'anonymous');
  const csp = doc.querySelector('[http-equiv]').content;
  assert.match(csp, /script-src 'none'/);
  assert.match(csp, /img-src data:/);
  assert.match(csp, /font-src data: https:/);
  assert.match(csp, /connect-src 'none'/);
  assert.equal(doc.querySelectorAll('style')[1].textContent, css, 'imports are at the start of their stylesheet');
  const qrHtml = mod.exports.certificateHtmlDocument({ page_format: 'Letter', orientation: 'landscape', css_template: '', html_template: '<img src="{{certificate.qr_code_data_uri}}"><img src="prefix{{certificate.qr_code_data_uri}}"><div title="{{certificate.qr_code_data_uri}}"></div>' });
  const qrDoc = new JSDOM(qrHtml);
  assert.equal(qrDoc.window.document.querySelector('img').src, qrModule.exports.certificateQrPreview);
  assert.match(qrDoc.window.document.querySelector('img').src, /^data:image\/png;base64,/);
  assert.equal(qrDoc.window.document.querySelectorAll('img')[1].hasAttribute('src'), false);
  assert.equal(qrDoc.window.document.querySelector('div[title]').title, '{{certificate.qr_code_data_uri}}');
  qrDoc.window.close();
  result.window.close(); dom.window.close();
});
