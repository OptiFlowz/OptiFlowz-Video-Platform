import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { mock, test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';

test('source migration, HTTP CRUD and concurrent allocations in an isolated PostgreSQL schema', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const schema = `quiz_sources_test_${randomUUID().replaceAll('-', '')}`;
  const connectionString = process.env.TEST_DATABASE_URL;
  const admin = new pg.Client({ connectionString, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  await admin.connect();
  const pool = new pg.Pool({ connectionString, max: 4, connectionTimeoutMillis: 5000, statement_timeout: 10000, options: `-c search_path=${schema},public` });
  t.after(async () => {
    await pool.end();
    try { await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); } finally { await admin.end(); }
  });
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.query(`SET search_path TO ${schema},public`);
  await admin.query("CREATE TABLE users (id uuid PRIMARY KEY, status text DEFAULT 'active', authz_version integer DEFAULT 1)");
  let migration;
  for (const file of ['1791590400001_add-questions.sql', '1791590400003_add-question-groups.sql',
    '1791590400004_add-quizzes.sql', '1792195200000_add-quiz-feedback-and-scoring-settings.sql', '1792281600001_add-quiz-sources.sql']) {
    const sql = (await readFile(new URL(`../src/database/migrations/${file}`, import.meta.url), 'utf8')).replaceAll('public.', `${schema}.`);
    await admin.query(sql.split('-- Down Migration')[0]);
    migration = sql;
  }
  const owner = randomUUID(), other = randomUUID();
  await admin.query('INSERT INTO users(id) VALUES ($1),($2)', [owner, other]);
  let releases = 0;
  const queryOn = database => (sql, params) => database.query(sql.replaceAll('public.', `${schema}.`), params);
  mock.module(new URL('../src/database/index.js', import.meta.url).href, { namedExports: { writePool: {
    query: queryOn(pool), async connect() {
      const client = await pool.connect();
      return { query: queryOn(client), release() { releases++; client.release(); } };
    },
  } } });
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'quiz-sources-test-secret';
  t.after(() => { if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret; });
  const token = jwt.sign({ sub: owner, authzVersion: 1 }, process.env.JWT_SECRET);
  const otherToken = jwt.sign({ sub: other, authzVersion: 1 }, process.env.JWT_SECRET);
  const { default: router } = await import('../src/modules/quizzes-engine/quizzes-engine.routes.js');
  const app = express();
  app.use(express.json());
  app.use('/api/quizzes', router);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  async function http(method, path, body, bearer = token) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/quizzes${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, ...await response.json() };
  }
  const request = (method, quizId, suffix = '', body, bearer = token) => http(method, `/${quizId}/sources${suffix}`, body, bearer);
  const put = (id, sources) => request('PUT', id, '', { sources });
  async function quiz(userId = owner, count = 10) {
    const id = randomUUID();
    await admin.query("INSERT INTO quizzes(id,user_id,title,question_count) VALUES ($1,$2,'Quiz',$3)", [id, userId, count]);
    return id;
  }
  async function group(userId = owner) {
    const id = randomUUID();
    await admin.query('INSERT INTO question_groups(id,user_id,name) VALUES ($1,$2,$3)', [id, userId, id]);
    return id;
  }
  const percent = (group_id, question_percentage, position = 0) => ({ group_id, question_percentage, position });
  const count = (group_id, question_count, position = 0) => ({ group_id, question_count, position });
  const stored = async id => (await admin.query('SELECT * FROM quiz_sources WHERE quiz_id=$1 ORDER BY position,group_id', [id])).rows;

  await t.test('all six routes require access tokens and scope access to the quiz owner', async () => {
    const id = await quiz(), gid = await group();
    await put(id, [percent(gid, 100)]);
    for (const [method, suffix, body] of [['GET', '', undefined], ['GET', `/${gid}`, undefined],
      ['POST', '', percent(gid, 100)], ['PUT', '', { sources: [] }], ['PATCH', `/${gid}`, { position: 1 }], ['DELETE', `/${gid}`, undefined]]) {
      for (const bearer of [null, jwt.sign({ sub: owner, purpose: 'two_factor' }, process.env.JWT_SECRET)]) {
        assert.equal((await request(method, id, suffix, body, bearer)).status, 401);
      }
      assert.equal((await request(method, id, suffix, body, otherToken)).status, 404);
    }
    assert.equal((await request('POST', id, '', percent(await group(other), 100))).status, 404);
    assert.equal((await put(id, [percent(randomUUID(), 100)])).status, 404);
    assert.equal((await request('GET', randomUUID())).status, 404);
    assert.equal((await request('GET', id, `/${randomUUID()}`)).status, 404);
    assert.equal((await put(await quiz(other), [])).status, 404);
  });

  await t.test('single-source CRUD preserves omitted fields, allows mode switches and leaves groups intact', async () => {
    const id = await quiz(), gid = await group();
    const created = await request('POST', id.toUpperCase(), '', { group_id: gid.toUpperCase(), question_percentage: 100 });
    assert.equal(created.status, 201);
    assert.equal(created.source.position, 0);
    assert.equal(created.source.question_count, null);
    assert.equal(created.source.group.id, gid);
    assert.deepEqual((await request('GET', id, `/${gid}`)).source, created.source);
    assert.equal((await request('POST', id, '', percent(gid, 100))).status, 409);
    const moved = await request('PATCH', id, `/${gid}`, { position: 2 });
    assert.equal(moved.status, 200);
    assert.equal(moved.source.question_percentage, 100);
    assert.equal(moved.source.position, 2);
    assert.equal((await request('PATCH', id, `/${gid}`, { question_count: 10 })).status, 400);
    const switched = await request('PATCH', id, `/${gid}`, { question_percentage: null, question_count: 10 });
    assert.equal(switched.status, 200);
    assert.equal(switched.source.question_percentage, null);
    assert.equal(switched.source.question_count, 10);
    assert.equal((await request('DELETE', id, `/${gid}`)).status, 200);
    assert.equal((await request('DELETE', id, `/${gid}`)).status, 404);
    assert.equal((await admin.query('SELECT id FROM question_groups WHERE id=$1', [gid])).rowCount, 1);
  });

  await t.test('atomic replacement validates exact percentage sums, same mode and rolls back every failed change', async () => {
    const id = await quiz(), a = await group(), b = await group(), c = await group();
    assert.equal((await put(id, [percent(a, 33.33), percent(b, 33.33), percent(c, 33.34)])).status, 200);
    const before = await stored(id), released = releases;
    for (const sources of [[percent(a, 99.99)], [percent(a, 60), percent(b, 60)], [percent(a, 50), count(b, 5)],
      [count(a, 4), count(b, 5)], [count(a, 11)], [percent(a, 50), percent(a.toUpperCase(), 50)]]) {
      assert.equal((await put(id, sources)).status, 400);
      assert.deepEqual(await stored(id), before);
    }
    assert.ok(releases > released);
    assert.equal((await request('PATCH', id, `/${a}`, { question_percentage: 50 })).status, 400);
    assert.equal((await request('DELETE', id, `/${a}`)).status, 400);
    assert.deepEqual(await stored(id), before);
    assert.equal((await put(id, [count(a, 4), count(b, 6)])).status, 200);
    assert.equal((await put(id, [])).status, 200);
    assert.deepEqual(await stored(id), []);
  });

  await t.test('list supports all sorting fields, stable pagination, empty pages and basic group details', async () => {
    const id = await quiz(), a = await group(), b = await group(), c = await group();
    await put(id, [percent(a, 20), percent(b, 30), percent(c, 50, 1)]);
    const result = await request('GET', id);
    assert.equal(result.pagination.total, 3);
    for (const sortBy of ['position', 'group_id', 'question_percentage', 'question_count']) {
      for (const sortOrder of ['asc', 'desc']) {
        const expected = [...result.sources].sort((a, b) => {
          const diff = sortBy === 'group_id' ? a.group_id.localeCompare(b.group_id) : (a[sortBy] ?? 0) - (b[sortBy] ?? 0);
          return (sortOrder === 'asc' ? diff : -diff) || a.group_id.localeCompare(b.group_id);
        });
        const page = await request('GET', id, `?sortBy=${sortBy}&sortOrder=${sortOrder}&page=2&limit=1`);
        assert.equal(page.sources[0].group_id, expected[1].group_id);
        assert.deepEqual(page.pagination, { page: 2, limit: 1, total: 3, totalPages: 3, hasNextPage: true, hasPreviousPage: true });
      }
    }
    const emptyPage = await request('GET', id, '?page=10&limit=1');
    assert.deepEqual(emptyPage.sources, []);
    assert.equal(emptyPage.pagination.total, 3);
    assert.equal((await request('GET', await quiz())).pagination.total, 0);
    for (const suffix of ['?page=0', '?limit=101', '?sortBy=name', `?user_id=${other}`]) assert.equal((await request('GET', id, suffix)).status, 400);
  });

  await t.test('quiz count edits and group cascades cannot silently invalidate an allocation', async () => {
    const id = await quiz(), a = await group(), b = await group();
    await put(id, [count(a, 4), count(b, 6)]);
    const edit = await http('PATCH', `/${id}`, { question_count: 11 });
    assert.equal(edit.status, 400);
    assert.match(edit.message, /sum/);
    assert.equal((await admin.query('SELECT question_count FROM quizzes WHERE id=$1', [id])).rows[0].question_count, 10);
    const deletion = await http('DELETE', `/question-groups/${a}`);
    assert.equal(deletion.status, 400);
    assert.equal((await stored(id)).length, 2);
    assert.equal((await admin.query('SELECT id FROM question_groups WHERE id=$1', [a])).rowCount, 1);
    await put(id, [percent(a, 100)]);
    assert.equal((await http('PATCH', `/${id}`, { question_count: 11 })).status, 200);
    assert.equal((await http('DELETE', `/question-groups/${a}`)).status, 200);
    assert.deepEqual(await stored(id), []);
    await put(id, [percent(b, 100)]);
    assert.equal((await http('DELETE', `/${id}`)).status, 200);
    assert.deepEqual(await stored(id), []);
    assert.equal((await admin.query('SELECT id FROM question_groups WHERE id=$1', [b])).rowCount, 1);
  });

  await t.test('direct SQL enforces row constraints, ownership, aggregate totals and deferred multi-row writes', async () => {
    const id = await quiz(), a = await group(), b = await group(), foreign = await group(other);
    const insert = (gid, percentage, number, position = 0) => admin.query(
      'INSERT INTO quiz_sources(quiz_id,group_id,question_percentage,question_count,position) VALUES ($1,$2,$3,$4,$5)', [id, gid, percentage, number, position]);
    for (const args of [[a, null, null], [a, 100, 10], [a, 0, null], [a, 101, null], [a, 'NaN', null],
      [a, null, 0], [a, 100, null, -1], [a, 99, null], [a, null, 9], [foreign, 100, null]]) {
      await assert.rejects(insert(...args), { code: '23514' });
    }
    await assert.rejects(insert(randomUUID(), 100, null), { code: '23503' });
    await admin.query('BEGIN');
    try {
      await insert(a, 60, null);
      await insert(b, 40, null);
      await admin.query('COMMIT');
    } catch (error) { await admin.query('ROLLBACK'); throw error; }
    await assert.rejects(insert(a, 100, null), { code: '23505' });
    await assert.rejects(admin.query('UPDATE quiz_sources SET group_id=$1 WHERE quiz_id=$2 AND group_id=$3', [foreign, id, a]), { code: '23514' });
    await assert.rejects(admin.query('UPDATE question_groups SET user_id=$1 WHERE id=$2', [other, a]), { code: '23514' });
    await assert.rejects(admin.query('UPDATE quizzes SET user_id=$1 WHERE id=$2', [other, id]), { code: '23514' });
    const index = await admin.query('SELECT indexdef FROM pg_indexes WHERE schemaname=$1 AND indexname=$2', [schema, 'quiz_sources_group_id_idx']);
    assert.match(index.rows[0].indexdef, /\(group_id\)/);
  });

  await t.test('concurrent replacements serialize and retain a complete allocation', async () => {
    const id = await quiz(), a = await group(), b = await group(), c = await group();
    const results = await Promise.all([put(id, [percent(a, 60), percent(b, 40)]), put(id, [count(b, 3), count(c, 7)])]);
    assert.deepEqual(results.map(result => result.status), [200, 200]);
    const rows = await stored(id);
    assert.equal(rows.length, 2);
    assert.ok(rows.every(row => row.question_count === null) || rows.every(row => row.question_percentage === null));
    assert.equal(rows.reduce((sum, row) => sum + Number(row.question_percentage ?? row.question_count), 0), rows[0].question_count === null ? 100 : 10);
  });

  await t.test('rollback removes source triggers and preserves parent resources; migration reapplies', async () => {
    const id = await quiz(), a = await group();
    await put(id, [count(a, 10)]);
    await admin.query(migration.split('-- Down Migration')[1]);
    assert.equal((await admin.query('SELECT to_regclass($1) AS name', [`${schema}.quiz_sources`])).rows[0].name, null);
    await admin.query('UPDATE quizzes SET question_count=11 WHERE id=$1', [id]);
    await admin.query('UPDATE question_groups SET user_id=$1 WHERE id=$2', [other, a]);
    await admin.query(migration.split('-- Down Migration')[0]);
    assert.equal((await request('POST', id, '', count(await group(), 11))).status, 201);
  });
});
