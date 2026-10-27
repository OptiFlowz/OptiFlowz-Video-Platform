import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { mock, test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { listCertificatesSchema } from '../src/modules/certificates/helpers/certificates.validation.js';

test('certificate query validation defaults and rejects invalid filters/pagination', () => {
  assert.deepEqual(listCertificatesSchema.parse({}), { page: 1, limit: 20, sortBy: 'issued_at', sortOrder: 'desc' });
  for (const query of [{ status: 'pending' }, { quiz_id: 'bad' }, { certificate_template_id: 'bad' }, { user_id: randomUUID() },
    { page: '0' }, { page: '1.5' }, { limit: '101' }, { limit: '0' }, { offset: 1 }, { sortBy: 'issued_at; DROP TABLE certificates' },
    { sortOrder: 'DESC' }, { status: ['issued', 'revoked'] }, { issued_from: '2026-02-30T00:00:00Z' },
    { issued_from: '2026-01-01' }, { issued_from: '2026-02-01T00:00:00Z', issued_to: '2026-01-01T00:00:00Z' },
    { page: Number.MAX_SAFE_INTEGER, limit: 100 }]) assert.equal(listCertificatesSchema.safeParse(query).success, false, JSON.stringify(query));
});

test('owned certificate routes: authentication, filtering, sorting, pagination and immutable detail', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const schema = `cert_api_${randomUUID().replaceAll('-', '')}`;
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL, statement_timeout: 10000 });
  await client.connect();
  t.after(async () => { try { await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); } finally { await client.end(); } });
  await client.query(`CREATE SCHEMA ${schema}; SET search_path TO ${schema},public`);
  await client.query("CREATE TABLE users(id uuid PRIMARY KEY, status text DEFAULT 'active', authz_version integer DEFAULT 1)");
  for (const table of ['quizzes', 'quiz_attempts', 'certificate_templates']) await client.query(`CREATE TABLE ${table}(id uuid PRIMARY KEY)`);
  for (const file of ['1792926000001_add-certificates.sql', '1792926000002_certificate-number-per-year.sql',
    '1793059200000_certificate-attempt-on-delete-set-null.sql']) {
    const sql = await readFile(new URL(`../src/database/migrations/${file}`, import.meta.url), 'utf8');
    await client.query(sql.split('-- Down Migration')[0].replaceAll('public.', `${schema}.`));
  }
  const user = randomUUID(), other = randomUUID(), empty = randomUUID(), inactive = randomUUID();
  for (const id of [user, other, empty, inactive]) await client.query('INSERT INTO users(id) VALUES ($1)', [id]);
  await client.query("UPDATE users SET status='disabled' WHERE id=$1", [inactive]);
  const quizId = randomUUID(), otherQuizId = randomUUID(), templateId = randomUUID();
  await client.query('INSERT INTO quizzes VALUES ($1),($2)', [quizId, otherQuizId]);
  await client.query('INSERT INTO certificate_templates VALUES ($1)', [templateId]);
  const certificates = [];
  for (const [index, title] of ['Alpha 100%_\\path', 'Beta', 'Beta', 'Foreign'].entries()) {
    const attemptId = randomUUID();
    await client.query('INSERT INTO quiz_attempts VALUES ($1)', [attemptId]);
    const { rows } = await client.query(`INSERT INTO certificates
      (user_id,quiz_id,quiz_attempt_id,certificate_template_id,certificate_number,status,data_snapshot,template_snapshot,issued_at,created_at,revoked_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10) RETURNING *`,
    [index === 3 ? other : user, index === 2 ? otherQuizId : quizId, attemptId, templateId,
      `CERT-2026-${String(index + 1).padStart(6, '0')}`, index === 1 ? 'revoked' : 'issued',
      { quiz: { id: quizId, title }, user: { full_name: 'Recipient' }, result: { score_percentage: 95 } },
      { html_template: '<h1>{{quiz.title}}</h1>', css_template: '', page_format: 'A4', orientation: 'landscape' },
      index === 0 ? '2026-01-01T00:00:00Z' : '2026-02-01T00:00:00Z', index === 1 ? '2026-03-01T00:00:00Z' : null]);
    certificates.push(rows[0]);
  }
  mock.module(new URL('../src/database/index.js', import.meta.url).href, { namedExports: {
    writePool: { query: (sql, params) => client.query(sql.replaceAll('public.', `${schema}.`), params) },
  } });
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'certificate-api-test';
  t.after(() => { if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret; });
  const { default: router } = await import('../src/modules/certificates/certificates.routes.js');
  const app = express(); app.use('/api/certificates', router);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  async function request(path = '', actor = user, claims = {}) {
    const token = actor ? jwt.sign({ sub: actor, authzVersion: 1, ...claims }, process.env.JWT_SECRET) : null;
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/certificates${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
  }

  await t.test('lists require active recipients while certificate details are public', async () => {
    for (const path of ['']) {
      for (const actor of [null, inactive, randomUUID()]) assert.equal((await request(path, actor)).status, 401);
      assert.equal((await request(path, user, { authzVersion: 2 })).status, 401);
      assert.equal((await request(path, user, { purpose: '2fa' })).status, 401);
    }
    const list = await request();
    assert.equal(list.status, 200);
    assert.equal(list.cache, 'private, no-store');
    assert.equal(list.body.pagination.total, 3);
    assert.ok(list.body.certificates.every(row => row.user_id === user && !('data_snapshot' in row) && !('template_snapshot' in row)));
    assert.deepEqual(list.body.sorting, { sortBy: 'issued_at', sortOrder: 'desc' });
    assert.equal((await request(`/${certificates[3].id}`, null)).status, 200);
    assert.equal((await request(`/${certificates[0].id}`, inactive)).status, 200);
    assert.equal((await request(`/${randomUUID()}`)).status, 404);
    assert.equal((await request('/invalid')).status, 400);
    assert.equal((await request(`?user_id=${other}`)).status, 400);
    const detail = await request(`/${certificates[1].id}`, null);
    assert.equal(detail.status, 200);
    assert.equal(detail.cache, 'private, no-store');
    assert.equal(detail.body.certificate.status, 'revoked');
    assert.deepEqual(detail.body.certificate.data_snapshot, certificates[1].data_snapshot);
    assert.deepEqual(detail.body.certificate.template_snapshot, certificates[1].template_snapshot);
    assert.equal(detail.body.certificate.quiz_title, 'Beta');
    assert.equal((await request('/certificate-templates', null)).status, 401);
  });

  await t.test('filters combine, match literal search characters and use snapshot titles and inclusive UTC instants', async () => {
    const cases = [
      [{ status: 'issued' }, 2], [{ status: 'revoked' }, 1], [{ quiz_id: otherQuizId }, 1],
      [{ certificate_template_id: templateId }, 3], [{ quiz_id: randomUUID() }, 0],
      [{ certificate_number: '000001' }, 1], [{ certificate_number: '%' }, 0],
      [{ quiz_title: 'bEtA' }, 2], [{ quiz_title: '100%_\\' }, 1],
      [{ issued_from: '2026-02-01T01:00:00+01:00', issued_to: '2026-02-01T00:00:00Z' }, 2],
      [{ status: 'revoked', quiz_id: quizId, quiz_title: 'Beta', certificate_number: '000002', certificate_template_id: templateId }, 1],
    ];
    for (const [query, total] of cases) {
      const result = await request(`?${new URLSearchParams(query)}`);
      assert.equal(result.status, 200, JSON.stringify(query));
      assert.equal(result.body.pagination.total, total, JSON.stringify(query));
    }
    for (const query of ['status=pending', 'quiz_id=bad', 'limit=101', 'page=0', 'sortBy=unknown', 'status=issued&status=revoked',
      'issued_from=2026-03-01T00:00:00Z&issued_to=2026-01-01T00:00:00Z']) assert.equal((await request(`?${query}`)).status, 400, query);
  });

  await t.test('every sort is stable across page boundaries; empty and out-of-range pages keep correct totals', async () => {
    for (const sortBy of ['issued_at', 'created_at', 'certificate_number', 'quiz_title', 'status']) for (const sortOrder of ['asc', 'desc']) {
      const expected = certificates.slice(0, 3).sort((a, b) => {
        const value = row => sortBy === 'quiz_title' ? row.data_snapshot.quiz.title : row[sortBy];
        const comparison = value(a) < value(b) ? -1 : value(a) > value(b) ? 1 : 0;
        return comparison * (sortOrder === 'asc' ? 1 : -1) || a.id.localeCompare(b.id);
      }).map(row => row.id);
      const ids = [];
      for (let page = 1; page <= 3; page++) {
        const response = await request(`?sortBy=${sortBy}&sortOrder=${sortOrder}&limit=1&page=${page}`);
        assert.equal(response.status, 200);
        ids.push(...response.body.certificates.map(row => row.id));
        assert.deepEqual(response.body.pagination, { page, limit: 1, total: 3, totalPages: 3, hasNextPage: page < 3, hasPreviousPage: page > 1 });
      }
      assert.deepEqual(ids, expected, `${sortBy} ${sortOrder}`);
    }
    const beyond = (await request('?page=9&limit=2')).body;
    assert.deepEqual(beyond.certificates, []);
    assert.equal(beyond.pagination.total, 3);
    const none = (await request('', empty)).body;
    assert.deepEqual(none.certificates, []);
    assert.deepEqual(none.pagination, { page: 1, limit: 20, total: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false });
  });

  await t.test('deleted templates do not hide issued certificates or change snapshot details', async () => {
    await client.query('DELETE FROM certificate_templates WHERE id=$1', [templateId]);
    const detail = (await request(`/${certificates[0].id}`)).body.certificate;
    assert.equal(detail.certificate_template_id, null);
    assert.deepEqual(detail.template_snapshot, certificates[0].template_snapshot);
    assert.equal(detail.quiz_title, certificates[0].data_snapshot.quiz.title);
    assert.equal((await request()).body.pagination.total, 3);
    assert.equal((await request(`?certificate_template_id=${templateId}`)).body.pagination.total, 0);
  });

  await t.test('deleted attempts keep certificates listed and publicly verifiable from snapshots', async () => {
    const saved = certificates[0];
    await client.query('DELETE FROM quiz_attempts WHERE id=$1', [saved.quiz_attempt_id]);
    const detail = await request(`/${saved.id}`, null);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.certificate.quiz_attempt_id, null);
    assert.equal(detail.body.certificate.certificate_number, saved.certificate_number);
    assert.deepEqual(detail.body.certificate.data_snapshot, saved.data_snapshot);
    assert.deepEqual(detail.body.certificate.template_snapshot, saved.template_snapshot);
    const list = await request();
    assert.equal(list.body.pagination.total, 3);
    assert.equal(list.body.certificates.find(row => row.id === saved.id).quiz_attempt_id, null);
  });
});
