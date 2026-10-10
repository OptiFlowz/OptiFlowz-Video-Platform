import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { mock, test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { errorHandler } from '../src/middleware/error-handler.js';

test('quiz CRUD and existing submodule routing against PostgreSQL session-local tables', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  await client.connect();
  t.after(() => client.end());
  await client.query("CREATE TEMP TABLE users (id uuid PRIMARY KEY, status text DEFAULT 'active', authz_version integer DEFAULT 1)");
  for (const file of ['1791590400001_add-questions.sql', '1791590400002_add-question-timestamps.sql', '1791590400003_add-question-groups.sql', '1791590400004_add-quizzes.sql']) {
    const sql = await readFile(new URL(`../src/database/migrations/${file}`, import.meta.url), 'utf8');
    await client.query(sql.split('-- Down Migration')[0].replaceAll('public.', 'pg_temp.'));
  }
  const userId = randomUUID(), otherUserId = randomUUID();
  await client.query('INSERT INTO pg_temp.users(id) VALUES ($1),($2)', [userId, otherUserId]);
  const query = (sql, params) => client.query(sql.replaceAll('public.', 'pg_temp.'), params);
  mock.module(new URL('../src/database/index.js', import.meta.url).href, { namedExports: { writePool: { query } } });
  const { default: router } = await import('../src/modules/quizzes-engine/quizzes-engine.routes.js');
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'quizzes-test-secret';
  t.after(() => { if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret; });
  const token = jwt.sign({ sub: userId, authzVersion: 1 }, process.env.JWT_SECRET);
  const otherToken = jwt.sign({ sub: otherUserId, authzVersion: 1 }, process.env.JWT_SECRET);
  const app = express();
  app.use(express.json());
  app.use('/api/quizzes', router);
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/quizzes`;
  async function request(method, path = '', body, bearer = token) {
    const response = await fetch(baseUrl + path, {
      method, headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, ...await response.json() };
  }
  async function scenario(name, run) {
    await t.test(name, async () => { await client.query('TRUNCATE pg_temp.quizzes'); await run(); });
  }
  const minimal = { title: 'Quiz', question_count: 10 };

  await scenario('all five quiz endpoints require access tokens and reject temporary tokens', async () => {
    const temporary = jwt.sign({ sub: userId, purpose: 'two_factor' }, process.env.JWT_SECRET);
    for (const [method, path] of [['POST', ''], ['GET', ''], ['GET', `/${randomUUID()}`], ['PATCH', `/${randomUUID()}`], ['DELETE', `/${randomUUID()}`]]) {
      assert.equal((await request(method, path, undefined, null)).status, 401);
      assert.equal((await request(method, path, undefined, temporary)).status, 401);
    }
  });

  await scenario('creates and reads defaults and complete settings with numeric passing scores', async () => {
    const created = await request('POST', '', { ...minimal, title: ' Quiz ' });
    assert.equal(created.status, 201); assert.equal(created.success, true);
    const quiz = created.quiz;
    assert.deepEqual(quiz, { id: quiz.id, user_id: userId, ...minimal, description: null, status: 'draft',
      time_limit_seconds: null, max_attempts: null, passing_score_percentage: 50, shuffle_questions: true,
      shuffle_options: true, has_certificate: false, created_at: quiz.created_at, updated_at: quiz.updated_at });
    assert.equal(quiz.created_at, quiz.updated_at); assert.ok(Number.isFinite(Date.parse(quiz.created_at)));
    assert.deepEqual((await request('GET', `/${quiz.id}`)).quiz, quiz);
    assert.equal((await request('POST', '', minimal)).status, 201);
    const configured = { title: 'Configured', description: ' Details ', status: 'published', question_count: 5,
      time_limit_seconds: 600, max_attempts: 3, passing_score_percentage: 75.25,
      shuffle_questions: false, shuffle_options: false, has_certificate: true };
    const saved = await request('POST', '', configured);
    assert.equal(saved.status, 201);
    for (const [field, value] of Object.entries(configured)) assert.equal(saved.quiz[field], field === 'description' ? 'Details' : value);
    assert.equal(typeof saved.quiz.passing_score_percentage, 'number');
  });

  await scenario('partial PATCH preserves omitted fields, supports null/false/zero and updates the timestamp', async () => {
    const created = await request('POST', '', { ...minimal, description: 'Keep', time_limit_seconds: 600, max_attempts: 3, has_certificate: true });
    await client.query("UPDATE pg_temp.quizzes SET created_at='2026-01-01',updated_at='2026-01-01' WHERE id=$1", [created.quiz.id]);
    const original = (await request('GET', `/${created.quiz.id}`)).quiz;
    const renamed = await request('PATCH', `/${original.id}`, { title: ' Renamed ' });
    assert.equal(renamed.status, 200);
    assert.deepEqual(renamed.quiz, { ...original, title: 'Renamed', updated_at: renamed.quiz.updated_at });
    assert.ok(Date.parse(renamed.quiz.updated_at) > Date.parse(original.updated_at));
    const changes = { description: null, time_limit_seconds: null, max_attempts: null, passing_score_percentage: 0,
      shuffle_questions: false, shuffle_options: false, has_certificate: false, status: 'archived' };
    const cleared = await request('PATCH', `/${original.id}`, changes);
    assert.equal(cleared.status, 200);
    assert.deepEqual(cleared.quiz, { ...renamed.quiz, ...changes, updated_at: cleared.quiz.updated_at });
    const concurrent = await Promise.all([
      request('PATCH', `/${original.id}`, { title: 'Concurrent title' }),
      request('PATCH', `/${original.id}`, { description: 'Concurrent description' }),
    ]);
    assert.ok(concurrent.every(response => response.status === 200));
    const final = (await request('GET', `/${original.id}`)).quiz;
    assert.equal(final.title, 'Concurrent title'); assert.equal(final.description, 'Concurrent description');
    assert.equal(final.created_at, original.created_at); assert.equal(final.passing_score_percentage, 0);
  });

  await scenario('all reads and mutations are owner scoped and inaccessible IDs return 404', async () => {
    const { quiz } = await request('POST', '', minimal);
    for (const quizId of [quiz.id, randomUUID()]) {
      assert.equal((await request('GET', `/${quizId}`, undefined, otherToken)).status, 404);
      assert.equal((await request('PATCH', `/${quizId}`, { title: 'Stolen' }, otherToken)).status, 404);
      assert.equal((await request('DELETE', `/${quizId}`, undefined, otherToken)).status, 404);
    }
    assert.deepEqual((await request('GET', `/${quiz.id}`)).quiz, quiz);
    assert.deepEqual((await request('GET', '', undefined, otherToken)).quizzes, []);
  });

  await scenario('list filters title/status literally, counts only matching owned rows and uses replies pagination', async () => {
    for (const entry of [
      { title: 'JavaScript Basics', status: 'draft' }, { title: 'Advanced JavaScript', status: 'published' },
      { title: 'Python', status: 'archived' }, { title: 'Rates 100%_path\\file', status: 'draft' },
    ]) assert.equal((await request('POST', '', { ...minimal, ...entry })).status, 201);
    await request('POST', '', { ...minimal, title: 'JavaScript Foreign', status: 'published' }, otherToken);
    const filtered = await request('GET', '?title=%20JAVASCRIPT%20&status=published&page=1&limit=1');
    assert.equal(filtered.status, 200); assert.equal(filtered.quizzes[0].title, 'Advanced JavaScript');
    assert.deepEqual(filtered.pagination, { page: 1, limit: 1, total: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false });
    assert.deepEqual(filtered.sorting, { sortBy: 'created_at', sortOrder: 'asc' });
    const first = await request('GET', '?title=javascript&page=1&limit=1&sortBy=title');
    const second = await request('GET', '?title=javascript&page=2&limit=1&sortBy=title');
    assert.equal(first.pagination.total, 2); assert.equal(first.pagination.hasNextPage, true);
    assert.equal(second.pagination.hasPreviousPage, true); assert.equal(second.pagination.hasNextPage, false);
    assert.notEqual(first.quizzes[0].id, second.quizzes[0].id);
    for (const filter of ['%', '_', '\\']) {
      const literal = await request('GET', `?title=${encodeURIComponent(filter)}`);
      assert.equal(literal.pagination.total, 1); assert.equal(literal.quizzes[0].title, 'Rates 100%_path\\file');
    }
    const empty = await request('GET', '?title=not-found');
    assert.deepEqual(empty.quizzes, []); assert.equal(empty.pagination.totalPages, 0);
    const beyond = await request('GET', '?page=100&limit=1');
    assert.deepEqual(beyond.quizzes, []); assert.equal(beyond.pagination.total, 4);
    assert.equal(beyond.pagination.hasPreviousPage, true); assert.equal(beyond.pagination.hasNextPage, false);
    const all = await request('GET', '?title=%20');
    assert.equal(all.pagination.total, 4);
    assert.ok(all.quizzes.every(quiz => quiz.user_id === userId && typeof quiz.passing_score_percentage === 'number'));
    assert.equal('total' in all, false); assert.equal('offset' in all, false);
  });

  await scenario('all six sorting fields support asc/desc and tied values have stable page boundaries', async () => {
    const quizzes = [];
    for (const entry of [
      { title: 'Zulu', status: 'draft', question_count: 3, passing_score_percentage: 10.25 },
      { title: 'Alpha', status: 'published', question_count: 1, passing_score_percentage: 50 },
      { title: 'Beta', status: 'archived', question_count: 2, passing_score_percentage: 99.99 },
    ]) quizzes.push((await request('POST', '', entry)).quiz);
    for (let index = 0; index < quizzes.length; index++) {
      await client.query('UPDATE pg_temp.quizzes SET created_at=$2,updated_at=$3 WHERE id=$1',
        [quizzes[index].id, `2026-01-0${index + 1}T00:00:00Z`, `2026-02-0${3 - index}T00:00:00Z`]);
    }
    const statusOrder = { draft: 0, published: 1, archived: 2 };
    const expected = {
      created_at: quizzes.map(quiz => quiz.id), updated_at: quizzes.map(quiz => quiz.id).reverse(),
      title: quizzes.slice().sort((a, b) => a.title < b.title ? -1 : 1).map(quiz => quiz.id),
      status: quizzes.slice().sort((a, b) => statusOrder[a.status] - statusOrder[b.status]).map(quiz => quiz.id),
      question_count: quizzes.slice().sort((a, b) => a.question_count - b.question_count).map(quiz => quiz.id),
      passing_score_percentage: quizzes.slice().sort((a, b) => a.passing_score_percentage - b.passing_score_percentage).map(quiz => quiz.id),
    };
    for (const [sortBy, ascending] of Object.entries(expected)) {
      for (const sortOrder of ['asc', 'desc']) {
        const listed = await request('GET', `?sortBy=${sortBy}&sortOrder=${sortOrder}`);
        assert.equal(listed.status, 200); assert.deepEqual(listed.sorting, { sortBy, sortOrder });
        assert.deepEqual(listed.quizzes.map(quiz => quiz.id), sortOrder === 'asc' ? ascending : [...ascending].reverse());
      }
    }
    await client.query("UPDATE pg_temp.quizzes SET created_at='2026-01-01' WHERE user_id=$1", [userId]);
    const ids = [];
    for (let page = 1; page <= 3; page++) ids.push((await request('GET', `?page=${page}&limit=1`)).quizzes[0].id);
    assert.deepEqual(ids, quizzes.map(quiz => quiz.id).sort());
  });

  await scenario('invalid settings, readonly fields and malformed queries return 400 without writes', async () => {
    for (const [method, path, payload] of [
      ['POST', '', {}], ['POST', '', { ...minimal, question_count: 0 }], ['POST', '', { ...minimal, max_attempts: 0 }],
      ['POST', '', { ...minimal, passing_score_percentage: 100.01 }], ['POST', '', { ...minimal, passing_score_percentage: 50.555 }],
      ['POST', '', { ...minimal, user_id: otherUserId }], ['POST', '', { ...minimal, group_ids: [] }],
      ['PATCH', `/${randomUUID()}`, {}], ['PATCH', `/${randomUUID()}`, { updated_at: '2026-01-01' }],
      ['PATCH', `/${randomUUID()}`, { time_limit_seconds: -1 }], ['GET', '/invalid'], ['DELETE', '/invalid'],
      ['GET', '?page=0'], ['GET', '?limit=101'], ['GET', '?status=invalid'],
      ['GET', '?sortBy=invalid'], ['GET', '?sortOrder=invalid'], ['GET', '?offset=0'],
    ]) assert.equal((await request(method, path, payload)).status, 400, `${method} ${path}`);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_temp.quizzes')).rows[0].n, 0);
  });

  await scenario('quiz deletion is owner scoped and preserves questions/groups submodule routes', async () => {
    const { quiz } = await request('POST', '', minimal);
    assert.deepEqual(await request('DELETE', `/${quiz.id}`), { status: 200, success: true, deleted: true });
    assert.equal((await request('GET', `/${quiz.id}`)).status, 404);
    assert.equal((await request('DELETE', `/${quiz.id}`)).status, 404);
    const questions = await request('GET', '/questions');
    const groups = await request('GET', '/question-groups');
    assert.equal(questions.status, 200); assert.deepEqual(questions.questions, []);
    assert.equal(groups.status, 200); assert.deepEqual(groups.groups, []);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_temp.quizzes')).rows[0].n, 0);
  });
});
