import { upgradeQuestionCategories } from './helpers/question-categories-schema.js';
import { installQuizPermissions } from './helpers/quiz-permissions-schema.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { mock, test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { errorHandler } from '../src/middleware/error-handler.js';

test('question category CRUD against PostgreSQL session-local tables', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  await client.connect();
  t.after(() => client.end());
  await client.query('CREATE TEMP TABLE users (id uuid PRIMARY KEY, status text DEFAULT \'active\', authz_version integer DEFAULT 1)');
  for (const file of ['1791590400001_add-questions.sql', '1791590400002_add-question-timestamps.sql', '1791590400003_add-question-groups.sql']) {
    const sql = await readFile(new URL(`../src/database/migrations/${file}`, import.meta.url), 'utf8');
    await client.query(sql.split('-- Down Migration')[0].replaceAll('public.', 'pg_temp.'));
  }
  const userId = randomUUID(), otherUserId = randomUUID();
  await client.query('INSERT INTO pg_temp.users(id) VALUES ($1),($2)', [userId, otherUserId]);
  await installQuizPermissions(client);
  await upgradeQuestionCategories(client);
  let failSync = false, releases = 0;
  const query = async (sql, params) => {
    const result = await client.query(sql.replaceAll('public.', 'pg_temp.'), params);
    if (failSync && /UPDATE public.questions SET category_id=NULL/.test(sql)) {
      failSync = false;
      throw new Error('Injected failure after category membership replacement');
    }
    return result;
  };
  mock.module(new URL('../src/database/index.js', import.meta.url).href, { namedExports: { writePool: {
    query, async connect() { return { query, release() { releases++; } }; },
  } } });
  const { default: router } = await import('../src/modules/quizzes-engine/quizzes-engine.routes.js');
  const { syncQuestionCategoryQuestionsInternal: sync } = await import('../src/modules/quizzes-engine/question-categories/handlers/syncQuestionCategoryQuestions.js');
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'question-categories-test-secret';
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
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/quizzes/question-categories`;
  async function request(method, path = '', body, bearer = token) {
    const response = await fetch(baseUrl + path, {
      method, headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, ...await response.json() };
  }
  async function questionRequest(method, path = '', body) {
    const response = await fetch(baseUrl.replace(/question-categories$/, 'questions') + path, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, ...await response.json() };
  }
  const categoryItems = async categoryId => (await client.query(
    'SELECT id AS question_id, ctid::text AS row_id FROM pg_temp.questions WHERE category_id=$1 ORDER BY id', [categoryId],
  )).rows;
  async function scenario(name, run) {
    await t.test(name, async () => {
      await client.query('TRUNCATE pg_temp.question_categories CASCADE');
      await run();
    });
  }

  await scenario('all category endpoints require access tokens', async () => {
    const temporary = jwt.sign({ sub: userId, purpose: 'two_factor' }, process.env.JWT_SECRET);
    for (const [method, path] of [['POST', ''], ['GET', ''], ['GET', `/${randomUUID()}`], ['PATCH', `/${randomUUID()}`], ['DELETE', `/${randomUUID()}`], ['PUT', `/${randomUUID()}/questions`]]) {
      assert.equal((await request(method, path, undefined, null)).status, 401);
      assert.equal((await request(method, path, undefined, temporary)).status, 401);
    }
  });

  await scenario('creates and reads categories using the authenticated owner and nullable descriptions', async () => {
    const created = await request('POST', '', { name: ' Languages ', description: ' Practice ' });
    assert.equal(created.status, 201); assert.equal(created.success, true);
    assert.deepEqual(created.category, { id: created.category.id, user_id: userId, name: 'Languages', description: 'Practice' });
    assert.deepEqual((await request('GET', `/${created.category.id}`)).category, { ...created.category, questions: [] });
    const noDescription = await request('POST', '', { name: 'x'.repeat(255) });
    assert.equal(noDescription.status, 201); assert.equal(noDescription.category.description, null);
  });

  await scenario('foreign and nonexistent categories return 404 without modifying another owner’s data', async () => {
    const { category } = await request('POST', '', { name: 'Private' });
    for (const categoryId of [category.id, randomUUID()]) {
      assert.equal((await request('GET', `/${categoryId}`, undefined, otherToken)).status, 404);
      assert.equal((await request('PATCH', `/${categoryId}`, { name: 'Stolen' }, otherToken)).status, 404);
      assert.equal((await request('DELETE', `/${categoryId}`, undefined, otherToken)).status, 404);
    }
    assert.deepEqual((await request('GET', `/${category.id}`)).category, { ...category, questions: [] });
  });

  await scenario('PATCH preserves omitted fields, allows clearing description and keeps ownership fixed', async () => {
    const { category } = await request('POST', '', { name: 'Languages', description: 'Practice' });
    const renamed = await request('PATCH', `/${category.id}`, { name: ' Updated ' });
    assert.equal(renamed.status, 200);
    assert.deepEqual(renamed.category, { ...category, name: 'Updated' });
    const cleared = await request('PATCH', `/${category.id}`, { description: null });
    assert.deepEqual(cleared.category, { ...category, name: 'Updated', description: null });
    const responses = await Promise.all([
      request('PATCH', `/${category.id}`, { name: 'Concurrent name' }),
      request('PATCH', `/${category.id}`, { description: 'Concurrent description' }),
    ]);
    assert.ok(responses.every(response => response.status === 200));
    assert.deepEqual((await request('GET', `/${category.id}`)).category,
      { ...category, name: 'Concurrent name', description: 'Concurrent description', questions: [] });
  });

  await scenario('duplicate create and rename return 409 while different users can reuse a name', async () => {
    const first = await request('POST', '', { name: 'Alpha' });
    const second = await request('POST', '', { name: 'Beta' });
    assert.equal((await request('POST', '', { name: ' Alpha ' })).status, 409);
    assert.equal((await request('PATCH', `/${second.category.id}`, { name: 'Alpha' })).status, 409);
    assert.deepEqual((await request('GET', `/${second.category.id}`)).category, { ...second.category, questions: [] });
    assert.equal((await request('POST', '', { name: 'Alpha' }, otherToken)).status, 201);
    assert.equal((await request('POST', '', { name: 'alpha' })).status, 201);
    assert.equal((await request('PATCH', `/${first.category.id}`, { name: 'Alpha' })).status, 200);
    const competing = await Promise.all([request('POST', '', { name: 'Concurrent' }), request('POST', '', { name: 'Concurrent' })]);
    assert.deepEqual(competing.map(response => response.status).sort(), [201, 409]);
  });

  await scenario('name filtering is case-insensitive, literal and owner scoped with matching pagination counts', async () => {
    const names = ['Advanced JavaScript', 'JavaScript Basics', 'Python', 'Rates 100%', 'under_score', 'back\\slash'];
    for (const name of names) assert.equal((await request('POST', '', { name })).status, 201);
    await request('POST', '', { name: 'JavaScript Foreign' }, otherToken);
    const filtered = await request('GET', '?name=%20JAVASCRIPT%20&limit=1&page=1');
    assert.deepEqual(filtered.pagination, { page: 1, limit: 1, total: 2, totalPages: 2, hasNextPage: true, hasPreviousPage: false });
    assert.deepEqual(filtered.sorting, { sortBy: 'name', sortOrder: 'asc' });
    assert.equal(filtered.categories[0].name, 'Advanced JavaScript');
    const second = await request('GET', '?name=javascript&limit=1&page=2');
    assert.equal(second.categories[0].name, 'JavaScript Basics');
    assert.equal(second.pagination.hasPreviousPage, true); assert.equal(second.pagination.hasNextPage, false);
    const reversed = await request('GET', '?name=javascript&sortOrder=desc');
    assert.deepEqual(reversed.categories.map(category => category.name), ['JavaScript Basics', 'Advanced JavaScript']);
    for (const [filter, expected] of [['%', 'Rates 100%'], ['_', 'under_score'], ['\\', 'back\\slash']]) {
      const response = await request('GET', `?name=${encodeURIComponent(filter)}`);
      assert.equal(response.pagination.total, 1); assert.equal(response.categories[0].name, expected);
    }
    const empty = await request('GET', `?name=${encodeURIComponent("' OR true --")}`);
    assert.deepEqual(empty.categories, []);
    assert.deepEqual(empty.pagination, { page: 1, limit: 20, total: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false });
    const all = await request('GET', '?name=%20');
    assert.equal(all.pagination.total, names.length); assert.ok(all.categories.every(category => category.user_id === userId));
    const beyond = await request('GET', '?page=100&limit=1');
    assert.deepEqual(beyond.categories, []); assert.equal(beyond.pagination.total, names.length);
    assert.equal(beyond.pagination.hasPreviousPage, true); assert.equal(beyond.pagination.hasNextPage, false);
  });

  await scenario('name and UUID sorting support both asc and desc', async () => {
    const categories = [];
    for (const name of ['Gamma', 'Alpha', 'Beta']) categories.push((await request('POST', '', { name })).category);
    for (const sortBy of ['name', 'id']) {
      const expected = categories.slice().sort((a, b) => a[sortBy] < b[sortBy] ? -1 : 1).map(category => category.id);
      for (const sortOrder of ['asc', 'desc']) {
        const result = await request('GET', `?sortBy=${sortBy}&sortOrder=${sortOrder}`);
        assert.deepEqual(result.sorting, { sortBy, sortOrder });
        assert.deepEqual(result.categories.map(category => category.id), sortOrder === 'asc' ? expected : [...expected].reverse());
      }
    }
  });

  await scenario('invalid metadata and membership payloads return 400, and membership POST is not registered', async () => {
    const { category: existing } = await request('POST', '', { name: 'Existing' });
    for (const [method, path, body] of [
      ['POST', '', {}], ['POST', '', { name: ' ' }], ['POST', '', { name: 'x'.repeat(256) }],
      ['POST', '', { name: 'A', user_id: otherUserId }], ['POST', '', { name: 'A', question_ids: [] }],
      ['GET', '/invalid'], ['DELETE', '/invalid'], ['PATCH', '/invalid', { name: 'A' }],
      ['PATCH', `/${existing.id}`, {}], ['PATCH', `/${existing.id}`, { questions: [] }],
      ['GET', '?page=0'], ['GET', '?limit=101'], ['GET', '?offset=0'],
      ['GET', '?sortBy=invalid'], ['GET', '?sortOrder=invalid'],
    ]) assert.equal((await request(method, path, body)).status, 400, `${method} ${path}`);
    const response = await fetch(`${baseUrl}/${randomUUID()}/questions`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 404);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_temp.question_categories')).rows[0].n, 1);
  });

  await scenario('deleting a category clears assignments and preserves original questions', async () => {
    const { category } = await request('POST', '', { name: 'Delete me' });
    const { category: retained } = await request('POST', '', { name: 'Keep me' });
    const question = (await questionRequest('POST', '', { type: 'single_choice', content: 'Keep', category_id: category.id })).question;
    assert.equal((await request('DELETE', `/${category.id}`)).status, 200);
    assert.equal((await questionRequest('GET', `/${question.id}`)).question.category, null);
    assert.equal((await request('GET', `/${retained.id}`)).status, 200);
  });

  await scenario('membership PUT moves questions from other categories, clears omissions and returns details', async () => {
    const { category } = await request('POST', '', { name: 'Target' });
    const { category: other } = await request('POST', '', { name: 'Other' });
    const made = [];
    for (const type of ['single_choice', 'multiple_choice', 'matching']) {
      made.push((await questionRequest('POST', '', { type, content: 'Draft', category_id: other.id })).question);
    }
    const ids = made.map(q => q.id);
    assert.deepEqual((await request('PUT', `/${category.id}/questions`, { question_ids: [...ids, ids[0].toUpperCase()] })).question_ids, ids.slice().sort());
    assert.deepEqual((await request('GET', `/${other.id}`)).category.questions, []);
    const details = (await request('GET', `/${category.id}`)).category.questions;
    assert.equal(details.length, 3);
    assert.ok(details.every(q => q.category.id === category.id && q.category.name === category.name));
    const before = await categoryItems(category.id);
    await request('PUT', `/${category.id}/questions`, { question_ids: ids });
    assert.deepEqual(await categoryItems(category.id), before);
    await request('PUT', `/${category.id}/questions`, { question_ids: ids.slice(1) });
    assert.equal((await questionRequest('GET', `/${ids[0]}`)).question.category, null);
    await questionRequest('PATCH', `/${ids[1]}`, { category_id: other.id });
    assert.deepEqual((await categoryItems(other.id)).map(q => q.question_id), [ids[1]]);
    await request('PUT', `/${category.id}/questions`, { question_ids: [] });
    assert.equal((await questionRequest('GET', `/${ids[2]}`)).question.category, null);
    assert.equal((await questionRequest('GET', `/${ids[1]}`)).question.category.id, other.id);
  });

  await scenario('missing and foreign categories/questions reject the entire membership replacement', async () => {
    const { category } = await request('POST', '', { name: 'Private target' });
    const { category: foreignCategory } = await request('POST', '', { name: 'Foreign target' }, otherToken);
    const old = (await questionRequest('POST', '', { type: 'single_choice', content: 'Old', category_id: category.id })).question;
    const added = (await questionRequest('POST', '', { type: 'single_choice', content: 'New' })).question;
    const foreignQuestion = (await client.query("INSERT INTO pg_temp.questions(user_id,type,content) VALUES ($1,'matching','Foreign') RETURNING id", [otherUserId])).rows[0].id;
    const before = await categoryItems(category.id);
    for (const invalidQuestion of [foreignQuestion, randomUUID()]) {
      assert.equal((await request('PUT', `/${category.id}/questions`, { question_ids: [added.id, invalidQuestion] })).status, 404);
      assert.deepEqual(await categoryItems(category.id), before);
      assert.deepEqual((await questionRequest('GET', `/${old.id}`)).question, old);
      assert.deepEqual((await questionRequest('GET', `/${added.id}`)).question, added);
    }
    for (const categoryId of [foreignCategory.id, randomUUID()]) {
      assert.equal((await request('PUT', `/${categoryId}/questions`, { question_ids: [added.id] })).status, 404);
      assert.equal((await request('PUT', `/${categoryId}/questions`, { question_ids: [] })).status, 404);
    }
    assert.equal((await request('PUT', `/${category.id}/questions`, { question_ids: [foreignQuestion] }, otherToken)).status, 404);
    assert.deepEqual(await categoryItems(category.id), before);
  });

  await scenario('membership PUT rejects omitted, malformed or spoofed bodies instead of accidentally clearing a category', async () => {
    const { category } = await request('POST', '', { name: 'Validation target' });
    const question = (await questionRequest('POST', '', { type: 'single_choice', content: 'Preserve', category_id: category.id })).question;
    const before = await categoryItems(category.id);
    for (const body of [undefined, null, [], {}, { question_ids: null }, { question_ids: question.id },
      { question_ids: ['invalid'] }, { question_ids: [], user_id: otherUserId }, { question_ids: [], name: 'Rename' }]) {
      assert.equal((await request('PUT', `/${category.id}/questions`, body)).status, 400);
      assert.deepEqual(await categoryItems(category.id), before);
    }
    assert.equal((await request('PUT', '/invalid/questions', { question_ids: [] })).status, 400);
  });

  await scenario('membership replacement failure rolls back inserted and removed links and releases the connection', async () => {
    const { category } = await request('POST', '', { name: 'Rollback target' });
    const old = (await questionRequest('POST', '', { type: 'single_choice', content: 'Old', category_id: category.id })).question;
    const added = (await questionRequest('POST', '', { type: 'single_choice', content: 'New' })).question;
    const before = await categoryItems(category.id), releasedBefore = releases;
    failSync = true;
    await assert.rejects(sync({ categoryId: category.id }, { question_ids: [added.id] }, userId), /Injected failure after category membership replacement/);
    assert.equal(releases, releasedBefore + 1);
    assert.deepEqual(await categoryItems(category.id), before);
    assert.deepEqual((await questionRequest('GET', `/${old.id}`)).question, old);
    assert.deepEqual((await questionRequest('GET', `/${added.id}`)).question, added);
    const retry = await request('PUT', `/${category.id}/questions`, { question_ids: [added.id] });
    assert.deepEqual(retry.question_ids, [added.id]);
  });
});
