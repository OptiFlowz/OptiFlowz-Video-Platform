import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import express from 'express';
import { validateTemplateContent, normalizeTemplateHtml } from '../src/modules/certificates/certificate-templates/helpers/templateContent.validation.js';
import { buildPreviewDocument } from '../src/modules/certificates/certificate-templates/helpers/previewDocument.js';
import { conditionalJsonParser } from '../src/middleware/request-parsers.js';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" focusable="false" viewBox="0 0 100 50" width="100" height="50">
  <defs><linearGradient id="gold"><stop offset="0" stop-color="#ffd700"/><stop offset="1" stop-color="#fff"/></linearGradient>
  <clipPath id="clip"><rect width="100" height="50" rx="5"/></clipPath><path id="line" d="M0 30 H100"/></defs>
  <g clip-path="url(#clip)"><rect width="100" height="50" fill="url(#gold)" stroke="black"/></g>
  <text font-family="Custom" font-size="12"><textPath href="#line">Award</textPath></text></svg>`;
const svgData = value => `data:image/svg+xml,${encodeURIComponent(value)}`;
const source = { html_template: svg, css_template: 'svg {fill:gold;stroke-width:2} text {font-family:Custom}', page_format: 'A4', orientation: 'landscape' };

test('inline SVG preserves case, local references, geometry, typography and source', () => {
  const original = structuredClone(source);
  validateTemplateContent(source);
  assert.deepEqual(source, original);
  const normalized = normalizeTemplateHtml(svg);
  for (const name of ['viewBox', 'linearGradient', 'clipPath', 'textPath']) assert.ok(normalized.includes(name));
  assert.match(normalized, /clip-path="url\(#clip\)"/);
  assert.match(buildPreviewDocument(source).html, /<svg/);
  assert.doesNotThrow(() => validateTemplateContent({ html_template: '<svg><text>{{user.full_name}}</text></svg>' }));
});

test('SVG data images work in HTML and CSS as percent-encoded XML or base64', () => {
  for (const url of [svgData(svg), `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`]) {
    const template = { ...source, html_template: `<img src="${url}" alt="Seal">`, css_template: `.seal {background-image:url("${url}")}` };
    assert.doesNotThrow(() => validateTemplateContent(template));
    assert.ok(buildPreviewDocument(template).html.includes(url));
  }
});

test('SVG rejects active content, external references, XML entities and nested resources', () => {
  const invalid = ['<svg><script>alert(1)</script></svg>', '<svg onload="alert(1)"></svg>',
    '<svg><foreignObject><p>HTML</p></foreignObject></svg>', '<svg><animate attributeName="href"/></svg>',
    '<svg><use href="https://example.com/icon.svg#x"/></svg>', '<svg><use href="javascript:alert(1)"/></svg>',
    '<svg><image href="https://example.com/image.png"/></svg>', '<svg><rect fill="url(https://example.com/paint)"/></svg>',
    '<svg><rect style="fill:url(https://example.com/paint)"/></svg>', '<svg xmlns="http://www.w3.org/1999/xhtml"></svg>',
    '<svg><use xlink:href="file:///etc/passwd"/></svg>', '<svg><g><div>Invalid namespace</div></g></svg>'];
  for (const html of invalid) {
    assert.throws(() => validateTemplateContent({ html_template: html }), { status: 422 }, html);
    assert.throws(() => validateTemplateContent({ html_template: `<img src="${svgData(html)}">` }), { status: 422 }, html);
  }
  for (const xml of ['<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>',
    '<?xml-stylesheet href="https://example.com/a.css"?><svg/>', '<svg>', '<svg><text>{{user.full_name}}</text></svg>']) {
    assert.throws(() => validateTemplateContent({ css_template: `.x {background:url("${svgData(xml)}")}` }), { status: 422 });
  }
});

test('font-face supports embedded fonts and rewrites public URLs without fetching them', () => {
  const dataFont = 'data:font/woff2;base64,' + Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(44)]).toString('base64');
  const template = { ...source, css_template: `@font-face {font-family:Custom;src:url('${dataFont}') format('woff2')}
    @FONT-FACE {font-family:Remote;src:url('https://cdn.example.com/custom.woff2') format('woff2')}
    .certificate {font-family:Custom} text {font-family:Remote}` };
  const document = buildPreviewDocument(template);
  assert.deepEqual(document.fontSources, ['https://cdn.example.com/custom.woff2']);
  assert.match(document.html, /https:\/\/certificate-fonts.invalid\/0/);
  assert.ok(document.html.includes(dataFont));
  for (const url of ['data:text/html;base64,PHNjcmlwdD4=', 'data:font/woff2;base64,!!!',
    'data:font/woff2;base64,PGh0bWw+YmFkPC9odG1sPg==', 'file:///tmp/font.ttf']) {
    assert.throws(() => validateTemplateContent({ css_template: `@font-face{font-family:X;src:url('${url}')}` }), { status: 422 });
  }
  assert.throws(() => validateTemplateContent({ html_template: `<a href="${dataFont}">Font</a>` }), { status: 422 });
});

test('Google Fonts links and imports are collected, deduplicated and removed from browser HTML', () => {
  const url = 'https://fonts.googleapis.com/css2?family=Roboto&display=swap';
  const document = buildPreviewDocument({ ...source,
    html_template: `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="${url}">${svg}`,
    css_template: `@import url('${url}'); text {font-family:Roboto}`,
  });
  assert.deepEqual(document.fontStylesheets, [url]);
  assert.doesNotMatch(document.html, /<link|@import/);
  for (const html_template of ['<link rel="stylesheet" href="https://example.com/a.css">',
    '<link rel="stylesheet" href="https://fonts.googleapis.com.evil.test/css2">',
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2" crossorigin="use-credentials">']) {
    assert.throws(() => validateTemplateContent({ html_template }), { status: 422 });
  }
  for (const css_template of ["@import 'https://example.com/a.css';", "@import 'https://fonts.googleapis.com/other';",
    "@media print {@import 'https://fonts.googleapis.com/css2';}"]) {
    assert.throws(() => validateTemplateContent({ css_template }), { status: 422 });
  }
});

test('larger embedded-font request bodies are accepted only for certificate routes', async t => {
  const app = express();
  app.use(conditionalJsonParser);
  app.post('/api/certificates/certificate-templates', (req, res) => {
    validateTemplateContent(req.body); res.sendStatus(204);
  });
  app.post('/api/unrelated', (_req, res) => res.sendStatus(204));
  app.use((err, _req, res, _next) => res.status(err.status || 500).end());
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const payload = JSON.stringify({ css_template: '/*' + 'x'.repeat(150 * 1024) + '*/' });
  for (const [path, status] of [['/api/certificates/certificate-templates', 204], ['/api/unrelated', 413]]) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload });
    assert.equal(response.status, status);
  }
});
