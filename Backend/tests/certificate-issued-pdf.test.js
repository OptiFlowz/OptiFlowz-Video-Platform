import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { once } from 'node:events';
import express from 'express';
import sharp from 'sharp';
import jsQR from 'jsqr';

const id = '12345678-1234-4234-8234-123456789abc';
const certificate = {
  id, certificate_template_id: null, status: 'issued', certificate_number: 'CERT-2026-000042', issued_at: new Date('2026-10-26T23:30:00Z'),
  data_snapshot: { user: { full_name: '<b>Ana & Petar</b>' }, quiz: { title: 'Saved title {{user.full_name}}' },
    result: { score_percentage: 87.5, earned_points: 7, max_points: 8 } },
  template_snapshot: { html_template: '<h1>{{user.full_name}}</h1><p>{{quiz.title}}</p><p>{{result.score_percentage}}%: {{result.earned_points}} / {{result.max_points}}</p><p>{{certificate.number}} — {{certificate.issued_at}}</p><img src="{{certificate.qr_code_data_uri.dots_rounded}}">',
    css_template: 'h1 {color:navy}', page_format: 'Letter', orientation: 'landscape' },
};
let stored = structuredClone(certificate), rendered, renderError, renderCount = 0;
const queries = [];
mock.module(new URL('../src/database/index.js', import.meta.url).href, { namedExports: { writePool: { async query(sql, params) {
  queries.push({ sql, params });
  assert.match(sql, /FROM public.certificates WHERE id=\$1/);
  assert.deepEqual(params.length, 1);
  return { rows: params[0] === id && stored ? [structuredClone(stored)] : [] };
} } } });
mock.module(new URL('../src/modules/certificates/certificate-templates/services/renderCertificatePdf.js', import.meta.url).href, {
  namedExports: { async renderCertificatePdf(document, options) {
    renderCount++; rendered = document; assert.ok(options.signal instanceof AbortSignal);
    if (renderError) throw renderError;
    return Buffer.from('%PDF-1.7\nissued-certificate');
  } },
});

test('public certificate PDF uses snapshots, real QR URL, shared renderer and bounded errors', async t => {
  const previous = process.env.FRONTEND_BASE_URL;
  process.env.FRONTEND_BASE_URL = 'https://videoplatform.optiflowz.com/app/?old=1#x';
  t.after(() => { if (previous === undefined) delete process.env.FRONTEND_BASE_URL; else process.env.FRONTEND_BASE_URL = previous; });
  const { default: router } = await import('../src/modules/certificates/certificates.routes.js');
  const app = express(); app.use('/api/certificates', router);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const get = path => fetch(`http://127.0.0.1:${server.address().port}/api/certificates/${path}`);
  const before = structuredClone(stored);
  const response = await get(`${id}/pdf`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/pdf/);
  assert.equal(response.headers.get('content-disposition'), `inline; filename="certificate-${id}.pdf"`);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(await response.text(), '%PDF-1.7\nissued-certificate');
  assert.equal(rendered.format, 'Letter'); assert.equal(rendered.landscape, true);
  assert.match(rendered.html, /&lt;b&gt;Ana &amp; Petar&lt;\/b&gt;/);
  assert.match(rendered.html, /Saved title &#123;&#123;user.full_name&#125;&#125;/);
  for (const text of ['87.5%: 7 / 8', 'CERT-2026-000042', 'October 26, 2026']) assert.ok(rendered.html.includes(text));
  assert.doesNotMatch(rendered.html, /John Anderson|Workplace Health/);
  const uri = rendered.html.match(/data:image\/png;base64,([^"\s]+)/)[1];
  const { data, info } = await sharp(Buffer.from(uri, 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(jsQR(new Uint8ClampedArray(data), info.width, info.height).data,
    `https://videoplatform.optiflowz.com/app/certificates/verify/${id}`);
  assert.deepEqual(stored, before);
  assert.ok(queries.every(({ sql }) => !/UPDATE|INSERT|DELETE/.test(sql)));
  assert.equal((await get(id)).status, 200);
  assert.equal((await get('')).status, 401);
  assert.equal((await get('invalid/pdf')).status, 400);
  assert.equal((await get('12345678-1234-4234-8234-123456789abd/pdf')).status, 404);
  stored.template_snapshot.html_template = '<p>{{user.full_name}}</p>';
  stored.status = 'revoked';
  delete process.env.FRONTEND_BASE_URL;
  const rendersBeforeRevocation = renderCount;
  const revoked = await get(`${id}/pdf`);
  assert.equal(revoked.status, 403, 'revoked certificates cannot be downloaded, including direct PDF requests');
  assert.doesNotMatch(revoked.headers.get('content-type'), /application\/pdf/);
  assert.equal(renderCount, rendersBeforeRevocation, 'revoked certificates never reach the PDF renderer');
  assert.equal((await get(id)).status, 200, 'public verification still shows revoked status');
  stored.status = 'issued';
  for (const status of [503, 504]) {
    renderError = Object.assign(new Error('Renderer unavailable'), { status });
    const failure = await get(`${id}/pdf`);
    assert.equal(failure.status, status);
    if (status === 503) assert.equal(failure.headers.get('retry-after'), '5');
  }
  renderError = null;
  const count = renderCount;
  stored.template_snapshot.html_template = '<script>alert(1)</script>';
  assert.equal((await get(`${id}/pdf`)).status, 422);
  stored.template_snapshot.html_template = '<p>{{quiz.title}}</p>';
  stored.data_snapshot.quiz = {};
  assert.equal((await get(`${id}/pdf`)).status, 422);
  assert.equal(renderCount, count);
  // Ten requests are allowed per IP per minute; further PDF work is rejected.
  await get(`${id}/pdf`); await get(`${id}/pdf`);
  assert.equal((await get(`${id}/pdf`)).status, 429);
  assert.equal(renderCount, count);
});
