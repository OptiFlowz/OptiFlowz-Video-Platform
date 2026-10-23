import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mock, test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import { validateTemplateContent } from '../src/modules/certificates/certificate-templates/helpers/templateContent.validation.js';
import {
  createCertificateTemplateSchema, updateCertificateTemplateSchema, listCertificateTemplatesSchema,
} from '../src/modules/certificates/certificate-templates/helpers/certificate-templates.validation.js';
import * as repository from '../src/modules/certificates/certificate-templates/repository/certificate-templates.repository.js';

const body = { name: 'Certificate', html_template: '<h1>{{user.full_name}}</h1>' };
const userId = '12345678-1234-4234-8234-123456789abc';
const id = '12345678-1234-4234-8234-123456789abd';

test('template schemas apply defaults and reject unknown, readonly, empty and invalid fields', () => {
  assert.deepEqual(createCertificateTemplateSchema.parse({ ...body, name: ' Certificate ' }), {
    ...body, description: null, css_template: '', page_format: 'A4', orientation: 'landscape',
  });
  for (const input of [undefined, null, {}, { ...body, name: ' ' }, { ...body, name: 'x'.repeat(256) },
    { ...body, html_template: ' \n ' }, { ...body, css_template: null }, { ...body, page_format: 'A3' },
    { ...body, orientation: 'diagonal' }, { ...body, user_id: userId }, { ...body, created_at: 'today' },
    { ...body, is_system: true }, { ...body, is_default: true }, { ...body, user_id: null }]) {
    assert.equal(createCertificateTemplateSchema.safeParse(input).success, false);
  }
  assert.deepEqual(updateCertificateTemplateSchema.parse({ description: null, css_template: '' }), { description: null, css_template: '' });
  assert.deepEqual(updateCertificateTemplateSchema.parse({ name: ' New ' }), { name: 'New' });
  for (const input of [{}, { user_id: userId }, { id }, { name: '' }, { html_template: null }, { page_format: null },
    { name: 'New', is_system: false }, { name: 'New', is_default: true }, { user_id: null }]) {
    assert.equal(updateCertificateTemplateSchema.safeParse(input).success, false);
  }
});

test('listing follows quiz pagination, sorting and strict query validation', () => {
  assert.deepEqual(listCertificateTemplatesSchema.parse({}), { page: 1, limit: 20, sortBy: 'created_at', sortOrder: 'asc' });
  assert.deepEqual(listCertificateTemplatesSchema.parse({ name: ' Course ', page_format: 'Letter', orientation: 'portrait',
    page: '2', limit: '5', sortBy: 'name', sortOrder: 'desc' }),
  { name: 'Course', page_format: 'Letter', orientation: 'portrait', page: 2, limit: 5, sortBy: 'name', sortOrder: 'desc' });
  for (const input of [{ page: 0 }, { page: 1.5 }, { limit: 101 }, { limit: 0 }, { offset: 5 },
    { sortBy: 'name; DROP TABLE users' }, { sortOrder: 'ASC' }, { user_id: userId }, { name: ['A'] },
    { page: String(Number.MAX_SAFE_INTEGER), limit: '100' }]) {
    assert.equal(listCertificateTemplatesSchema.safeParse(input).success, false);
  }
});

test('accepted HTML and CSS are returned unchanged, including layout, print, fonts and inline styles', () => {
  const template = {
    html_template: `<DIV class=' certificate  ' title=""><h1>{{user.full_name}} &amp; team</h1>
      <img src="https://assets.example.com/seal.png" alt="" width="120">
      <p style="display: flex; gap: 1rem; color: #123">Issued <b>today</b></p>
      <a href="#details">Details</a><table><tr><td colspan="2">Passed</td></tr></table></DIV>`,
    css_template: `@font-face { font-family: Certificate; src: url("https://assets.example.com/font.woff2") format("woff2"); }
      @page { size: A4 landscape; margin: 1cm; }
      @media print { .certificate { print-color-adjust: exact; } }
      @supports (display: grid) { .certificate { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); } }
      .certificate { --accent: #123; position: relative; color: var(--accent); font-family: Certificate, serif;
        background: linear-gradient(45deg, #fff, #eee); padding: clamp(1rem, 2vw, 3rem); border: 2px solid #123; }
      .certificate > h1 { position: absolute; top: 20px; transform: translateX(-50%); }
      .certificate::before { content: "Completed"; background-image: url(https://assets.example.com/seal.png); }`,
  };
  const original = structuredClone(template);
  assert.equal(validateTemplateContent(template), template);
  assert.deepEqual(template, original);
  for (const html_template of ['<p>Unclosed paragraph', '<DIV class="">Safe</DIV>', '<br/>', '<p>2 &lt; 3</p>', '<!-- comment --><p>Safe</p>']) {
    assert.equal(validateTemplateContent({ html_template }).html_template, html_template);
  }
});

test('HTML rejects active elements, event attributes, unsafe URLs and incomplete markup with 422', () => {
  const malicious = [
    '<script>alert(1)</script>', '<IFRAME src="https://example.com"></IFRAME>', '<object></object>', '<embed>',
    '<svg><script>alert(1)</script></svg>', '<math></math>', '<form><input></form>', '<style>body{color:red}</style>',
    '<link rel="stylesheet" href="https://example.com">', '<meta http-equiv="refresh" content="0;url=https://example.com">',
    '<img src="https://example.com/a" onerror="alert(1)">', '<p OnClick="alert(1)">X</p>', '<div data-evil="x">X</div>',
    '<a href="javascript:alert(1)">X</a>', '<a href="java&#x73;cript:alert(1)">X</a>', '<a href="java&#10;script:alert(1)">X</a>',
    '<img src="data:image/svg+xml;base64,PHN2Zz4=">', '<img src="file:///etc/passwd">', '<img src="//example.com/a">',
    '<img src="http://example.com/a">', '<img src="https://user:password@example.com/a">',
    '<div style="width:expression(alert(1))">X</div>', '<div style="background:url(javascript:alert(1))">X</div>',
    '<div style="color:red; } body {color:blue">X</div>', '<div style="@import url(https://example.com/a)">X</div>',
    '<script', '<div title="', '<!-- unfinished', '<img src="https://example.com/a" onerror="alert(1)"',
  ];
  for (const html_template of malicious) {
    assert.throws(() => validateTemplateContent({ html_template }), error => error.status === 422 && error.body.field === 'html_template', html_template);
  }
});

test('CSS rejects syntax errors, executable/obfuscated content, imports and style breakout with 422', () => {
  const malicious = [
    '.x { color: red', '.x {color: "red}', '.x {color: }', 'color: red;',
    '@import "https://example.com/a.css";', '@IMPORT url(https://example.com/a.css);', '@unknown {}',
    '.x { behavior: url(https://example.com/a.htc) }', '.x {-moz-binding:url(https://example.com/a.xml)}',
    '.x { width: expression(alert(1)) }', '.x { width: e/**/xpression(alert(1)) }',
    String.raw`.x { width: e\78pression(alert(1)) }`,
    '.x { background: url(javascript:alert(1)) }', String.raw`.x { background: u\72l("javascript:alert(1)") }`,
    String.raw`.x { background: url("\6a avascript:alert(1)") }`,
    '.x {background:url(file:///etc/passwd)}', '.x {background:url(//example.com/a)}',
    '.x {background:url(data:image/svg+xml;base64,PHN2Zz4=)}',
    '.x {--bad: expression(alert(1)); width:var(--bad)}',
    '.x {background:image-set("http://example.com/a" 1x)}', '.x {background:url(var(--asset))}',
    '.x {content:"</style><script>alert(1)</script>"}', '/* </STYLE><img src=x onerror=alert(1)> */',
    '.x {color: rgb(1,2,3}',
  ];
  for (const css_template of malicious) {
    assert.throws(() => validateTemplateContent({ css_template }), error => error.status === 422 && error.body.field === 'css_template', css_template);
  }
});

test('repository binds ownership and filters, escapes LIKE wildcards and allowlists sorting', async () => {
  const calls = [];
  const database = { async query(sql, params) { calls.push({ sql, params }); return { rows: [{ templates: [], total: 0 }], rowCount: 1 }; } };
  await repository.listCertificateTemplates(database, userId, { name: '100%_\\', page_format: 'A4', orientation: 'portrait',
    limit: 2, offset: 4, sortBy: 'name; DROP TABLE users', sortOrder: 'DESC; DROP TABLE users' });
  assert.deepEqual(calls[0].params, [userId, '%100\\%\\_\\\\%', 'A4', 'portrait', 2, 4]);
  assert.match(calls[0].sql, /WHERE \(user_id = \$1 OR is_system = true\) AND/);
  assert.match(calls[0].sql, /ORDER BY created_at ASC, id ASC/);
  assert.doesNotMatch(calls[0].sql, /DROP TABLE/);
  await repository.getCertificateTemplate(database, id, userId);
  await repository.updateCertificateTemplate(database, id, userId, { css_template: '', user_id: 'spoof' });
  await repository.deleteCertificateTemplate(database, id, userId);
  assert.match(calls[1].sql, /WHERE id = \$1 AND \(user_id = \$2 OR is_system = true\)/);
  for (const call of calls.slice(2)) {
    assert.match(call.sql, /WHERE id = \$1 AND user_id = \$2 AND is_system = false/);
    assert.deepEqual(call.params.slice(0, 2), [id, userId]);
  }
  assert.deepEqual(calls[2].params, [id, userId, '']);
  assert.match(calls[2].sql, /updated_at = now\(\)/);
  await repository.createCertificateTemplate(database, userId, { ...createCertificateTemplateSchema.parse(body), is_system: true, is_default: true });
  assert.match(calls[4].sql, /VALUES \(\$1, false, false,/);
});

const queries = [];
let result = { rows: [] };
mock.module(new URL('../src/database/index.js', import.meta.url).href, {
  namedExports: { writePool: { async query(sql, params) {
    if (sql.includes('FROM users')) return { rows: [{ id: userId, status: 'active', authz_version: 1 }] };
    queries.push({ sql, params });
    return result;
  } } },
});
const { createCertificateTemplateInternal: create } = await import('../src/modules/certificates/certificate-templates/handlers/createCertificateTemplate.js');
const { getCertificateTemplateInternal: get } = await import('../src/modules/certificates/certificate-templates/handlers/getCertificateTemplate.js');
const { getCertificateTemplatesInternal: list } = await import('../src/modules/certificates/certificate-templates/handlers/getCertificateTemplates.js');
const { updateCertificateTemplateInternal: update } = await import('../src/modules/certificates/certificate-templates/handlers/updateCertificateTemplate.js');
const { deleteCertificateTemplateInternal: remove } = await import('../src/modules/certificates/certificate-templates/handlers/deleteCertificateTemplate.js');

test('handlers reject unauthenticated, invalid and unsafe requests before querying templates', async () => {
  queries.length = 0;
  for (const action of [() => create(body), () => get({ id }), () => list({}), () => update({ id }, body), () => remove({ id })]) {
    await assert.rejects(action(), { status: 401 });
  }
  await assert.rejects(create({ ...body, user_id: userId }, userId), { status: 400 });
  await assert.rejects(get({ id: 'bad' }, userId), { status: 400 });
  await assert.rejects(list({ limit: 101 }, userId), { status: 400 });
  await assert.rejects(update({ id }, {}, userId), { status: 400 });
  await assert.rejects(remove({ id: 'bad' }, userId), { status: 400 });
  await assert.rejects(create({ ...body, html_template: '<script>x</script>' }, userId), { status: 422 });
  await assert.rejects(update({ id }, { css_template: '@import "https://example.com";' }, userId), { status: 422 });
  assert.equal(queries.length, 0);
});

test('HTTP CRUD uses auth, quiz-style envelopes, validation and owner-scoped queries', async t => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'certificate-template-test-secret';
  t.after(() => { if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret; });
  const { default: router } = await import('../src/modules/certificates/certificates.routes.js');
  const app = express();
  app.use(express.json());
  app.use('/api/certificates', router);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}/api/certificates/certificate-templates`;
  const token = jwt.sign({ sub: userId, authzVersion: 1 }, process.env.JWT_SECRET);
  async function request(method, path = '', data, authenticated = true) {
    const response = await fetch(base + path, { method, headers: {
      'Content-Type': 'application/json', ...(authenticated ? { Authorization: `Bearer ${token}` } : {}),
    }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: response.status, data: await response.json() };
  }
  for (const [method, path, data] of [['GET', ''], ['POST', '', body], ['GET', `/${id}`], ['PATCH', `/${id}`, { name: 'New' }], ['DELETE', `/${id}`]]) {
    assert.equal((await request(method, path, data, false)).status, 401);
  }
  const template = { id, user_id: userId, ...createCertificateTemplateSchema.parse(body) };
  result = { rows: [template] };
  assert.deepEqual(await request('POST', '', body), { status: 201, data: { success: true, template } });
  assert.equal(queries.at(-1).params[0], userId);
  assert.deepEqual(await request('GET', `/${id}`), { status: 200, data: { success: true, template } });
  result = { rows: [{ ...template, name: 'Updated' }] };
  const updated = await request('PATCH', `/${id}`, { name: 'Updated' });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.template.name, 'Updated');
  assert.deepEqual(queries.at(-1).params, [id, userId, 'Updated']);
  result = { rows: [{ templates: [template], total: 3 }] };
  const listing = await request('GET', '?page=2&limit=1&sortBy=name&sortOrder=desc&name=Cert&page_format=A4');
  assert.equal(listing.status, 200);
  assert.deepEqual(listing.data.pagination, { page: 2, limit: 1, total: 3, totalPages: 3, hasNextPage: true, hasPreviousPage: true });
  assert.deepEqual(listing.data.sorting, { sortBy: 'name', sortOrder: 'desc' });
  assert.deepEqual(queries.at(-1).params, [userId, '%Cert%', 'A4', null, 1, 1]);
  result = { rows: [{ templates: [], total: 3 }] };
  const emptyPage = await request('GET', '?page=10&limit=1');
  assert.deepEqual(emptyPage.data.templates, []);
  assert.equal(emptyPage.data.pagination.total, 3);
  assert.equal(emptyPage.data.pagination.hasNextPage, false);
  for (const [method, path, data] of [['POST', '', { ...body, html_template: '<script>x</script>' }],
    ['PATCH', `/${id}`, { css_template: '.x {behavior: url(https://example.com)}' }]]) {
    const before = queries.length;
    const response = await request(method, path, data);
    assert.equal(response.status, 422);
    assert.equal(response.data.success, false);
    assert.ok(response.data.field);
    assert.ok(response.data.message);
    assert.equal(queries.length, before);
  }
  result = { rows: [], rowCount: 0 };
  assert.equal((await request('GET', `/${id}`)).status, 404);
  assert.equal((await request('PATCH', `/${id}`, { name: 'New' })).status, 404);
  assert.equal((await request('DELETE', `/${id}`)).status, 404);
  result = { rows: [], rowCount: 1 };
  assert.deepEqual(await request('DELETE', `/${id}`), { status: 200, data: { success: true, deleted: true } });
});
