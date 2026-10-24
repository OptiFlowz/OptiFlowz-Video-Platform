import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mock, test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import { buildPreviewDocument } from '../src/modules/certificates/certificate-templates/helpers/previewDocument.js';
import { validateTemplateContent, MAX_TEMPLATE_BYTES } from '../src/modules/certificates/certificate-templates/helpers/templateContent.validation.js';
import { PREVIEW_DATA, escapeHtml } from '../src/modules/certificates/certificate-templates/helpers/templatePlaceholders.js';
import { loadDefaultCertificateTemplate } from './helpers/default-certificate-template.js';

const id = '12345678-1234-4234-8234-123456789abd';
const userId = '12345678-1234-4234-8234-123456789abc';
const otherUserId = '12345678-1234-4234-8234-123456789abe';
const template = {
  id, user_id: userId, html_template: '<h1>{{ user.full_name }}</h1><p>{{quiz.title}}</p>',
  css_template: 'body {color: navy} .certificate h1 {font-size: 24pt} @media print { p {display:grid} }',
  page_format: 'A4', orientation: 'landscape',
};

test('the seeded Classic template passes central validation and populates every placeholder', async () => {
  const systemTemplate = await loadDefaultCertificateTemplate();
  assert.doesNotThrow(() => validateTemplateContent(systemTemplate));
  const preview = buildPreviewDocument(systemTemplate);
  assert.equal(preview.format, 'Letter');
  assert.equal(preview.landscape, true);
  for (const value of Object.values(PREVIEW_DATA)) assert.ok(preview.html.includes(String(value)));
  assert.doesNotMatch(preview.html, /\{\{|\}\}/);
  assert.match(preview.html, /pointer-events: none/);
});

test('preview uses fixed data, scoped CSS, zero-margin page styles and unchanged source', () => {
  const source = { ...template, html_template: Object.keys(PREVIEW_DATA).map(key => `<p>{{${key}}}</p>`).join('') };
  const before = structuredClone(source);
  const document = buildPreviewDocument(source);
  assert.equal(document.format, 'A4');
  assert.equal(document.landscape, true);
  assert.match(document.html, /<div class="certificate"/);
  assert.match(document.html, /width:297mm!important;height:210mm!important/);
  assert.match(document.html, /@page \{ size:A4 landscape!important; margin:0!important; \}/);
  assert.match(document.html, /\.certificate:is\(\.certificate\)/);
  assert.match(document.html, /\.certificate :is\(p\)/);
  assert.match(document.html, /Content-Security-Policy/);
  for (const value of Object.values(PREVIEW_DATA)) assert.ok(document.html.includes(String(value)));
  assert.doesNotMatch(document.html, /\{\{|\}\}/);
  assert.deepEqual(source, before);
  const letter = buildPreviewDocument({ ...template, page_format: 'Letter', orientation: 'portrait' });
  assert.equal(letter.format, 'Letter');
  assert.equal(letter.landscape, false);
  assert.match(letter.html, /width:215\.9mm!important;height:279\.4mm!important/);
  assert.equal(escapeHtml('<img src=x onerror="x">&\''), '&lt;img src=x onerror=&quot;x&quot;&gt;&amp;&#39;');
  assert.doesNotThrow(() => buildPreviewDocument({ ...template,
    css_template: '@media print{@supports(display:grid){.certificate{display:grid}}}',
  }));
});

test('central validation rejects unknown, malformed, expression, attribute and CSS placeholders', () => {
  for (const html_template of [
    '<p>{{user.email}}</p>', '<p>{{constructor}}</p>', '<p>{{__proto__.name}}</p>', '<p>{{user.full_name}</p>',
    '<p>{{{user.full_name}}}</p>', '<p>{{user.full_name.toUpperCase()}}</p>', '<p>{{#if user}}</p>',
    '<p title="{{user.full_name}}">Name</p>', '<a href="https://example.com/{{user.full_name}}">X</a>',
    '<p title="&#123;&#123;user.full_name&#125;&#125;">X</p>',
    '<p>&#123;&#123;user.email&#125;&#125;</p>', '<p>{{user.<b>full_name</b>}}</p>',
  ]) assert.throws(() => validateTemplateContent({ html_template }), { status: 422 }, html_template);
  assert.throws(() => validateTemplateContent({ css_template: '.x {content:"{{user.full_name}}"}' }), { status: 422 });
  assert.throws(() => buildPreviewDocument({ ...template, page_format: 'A3' }), { status: 422 });
  assert.throws(() => buildPreviewDocument({ ...template, css_template: null }), { status: 422 });
  assert.throws(() => validateTemplateContent({ html_template: 'X'.repeat(MAX_TEMPLATE_BYTES + 1) }), { status: 422 });
  assert.throws(() => validateTemplateContent({ html_template: '<div>'.repeat(65) + 'X' + '</div>'.repeat(65) }), { status: 422 });
  assert.throws(() => validateTemplateContent({ css_template: '@media print {'.repeat(65) + '.x {color:red}' + '}'.repeat(65) }), { status: 422 });
});

test('preview balances fragments and fills entity-encoded text placeholders safely', () => {
  const document = buildPreviewDocument({ ...template, html_template: '</div><p>&#123;&#123;user.full_name&#125;&#125;</p>' });
  assert.match(document.html, />\s*<p>John Anderson<\/p><\/div><\/body>/);
  assert.doesNotMatch(document.html, /<\/div><p>/);
});

let stored = template;
let rendered = [];
const queries = [];
let renderError;
let canModerate = true;
mock.module(new URL('../src/database/index.js', import.meta.url).href, {
  namedExports: { writePool: { async query(sql, params) {
    if (sql.includes('FROM users')) return { rows: [{ id: params[0], status: 'active', authz_version: 1 }] };
    if (sql.includes('JOIN role_permissions')) return { rows: canModerate
      ? [{ id: '1', key: 'certificates.moderate', has_allow: true, has_deny: false }] : [] };
    if (sql.includes('FROM user_roles')) return { rows: [] };
    queries.push({ sql, params });
    assert.match(sql, /SELECT .* FROM public\.certificate_templates WHERE id = \$1 AND \(user_id = \$2 OR is_system = true\)/s);
    return { rows: stored && params[0] === stored.id && (params[1] === stored.user_id || stored.is_system === true) ? [stored] : [] };
  } } },
});
mock.module(new URL('../src/modules/certificates/certificate-templates/services/renderCertificatePdf.js', import.meta.url).href, {
  namedExports: { async renderCertificatePdf(document, options) {
    rendered.push({ document, options });
    if (renderError) throw renderError;
    return Buffer.from('%PDF-1.7\npreview-test');
  } },
});

test('preview HTTP route authenticates, checks ownership, revalidates stored content and returns binary without writes', async t => {
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'preview-test-secret';
  t.after(() => { if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous; });
  const { default: router } = await import('../src/modules/certificates/certificates.routes.js');
  const app = express();
  app.use(express.json());
  app.use('/api/certificates', router);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}/api/certificates/certificate-templates`;
  const token = user => jwt.sign({ sub: user, authzVersion: 1 }, process.env.JWT_SECRET);
  const request = (user = userId, targetId = id, body) => fetch(`${base}/${targetId}/preview/pdf`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${token(user)}` } : {}) },
    body: body && JSON.stringify(body),
  });
  assert.equal((await request(null)).status, 401);
  canModerate = false;
  t.after(() => { canModerate = true; });
  for (let attempt = 0; attempt < 11; attempt++) {
    const denied = await request();
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).requiredPermission, 'certificates.moderate');
  }
  assert.equal(queries.length, 0, 'permission is checked before reading the template');
  assert.equal(rendered.length, 0, 'permission is checked before rendering');
  canModerate = true;
  assert.equal((await request(userId, 'bad')).status, 400);
  assert.equal((await request(otherUserId)).status, 404);
  assert.equal((await request(userId, otherUserId)).status, 404);
  assert.equal(rendered.length, 0);
  const previousBaseUrl = process.env.FRONTEND_BASE_URL;
  process.env.FRONTEND_BASE_URL = 'https://videoplatform.optiflowz.com';
  t.after(() => {
    if (previousBaseUrl === undefined) delete process.env.FRONTEND_BASE_URL;
    else process.env.FRONTEND_BASE_URL = previousBaseUrl;
  });
  stored = { ...template, html_template: `${template.html_template}<img src="{{certificate.qr_code_data_uri.size_200.color_ff6937.dots_rounded.background_ffffff}}" class="qr-code">` };
  const originalStored = structuredClone(stored);
  const response = await request(userId, id, { html_template: '<script>x</script>', 'user.full_name': 'Override' });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^application\/pdf/);
  assert.equal(response.headers.get('content-disposition'), `inline; filename="certificate-preview-${id}.pdf"`);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(await response.text(), '%PDF-1.7\npreview-test');
  assert.match(rendered[0].document.html, /John Anderson/);
  assert.doesNotMatch(rendered[0].document.html, /Override/);
  assert.match(rendered[0].document.html, /<img src="data:image\/png;base64,/);
  assert.doesNotMatch(rendered[0].document.html, /\{\{/);
  assert.deepEqual(stored, originalStored);
  assert.ok(rendered[0].options.signal instanceof AbortSignal);
  for (const invalid of [{ html_template: '<script>alert(1)</script>' }, { css_template: '@import "https://example.com";' },
    { html_template: '<p>{{user.secret}}</p>' }, { orientation: 'diagonal' }]) {
    stored = { ...template, ...invalid };
    const failed = await request();
    assert.equal(failed.status, 422);
    assert.equal((await failed.json()).success, false);
  }
  assert.equal(rendered.length, 1);
  stored = { ...template, user_id: null, is_system: true, is_default: true };
  const systemPreview = await request(otherUserId);
  assert.equal(systemPreview.status, 200);
  assert.match(systemPreview.headers.get('content-type'), /^application\/pdf/);
  assert.equal(rendered.length, 2);
  stored = template;
  renderError = Object.assign(new Error('Certificate preview renderer is busy; retry shortly'), { status: 503 });
  assert.equal((await request()).status, 503);
  renderError = Object.assign(new Error('Certificate preview timed out'), { status: 504 });
  assert.equal((await request()).status, 504);
  renderError = undefined;
  assert.equal((await request()).status, 200);
  const limited = await request();
  assert.equal(limited.status, 429);
  for (const query of queries) assert.doesNotMatch(query.sql, /\b(INSERT|UPDATE|DELETE)\b/i);
});
