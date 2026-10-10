import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { mock, test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { errorHandler } from '../src/middleware/error-handler.js';

test('question group CRUD against PostgreSQL session-local tables', { skip: !process.env.TEST_DATABASE_URL }, async t => {
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
  let failSync = false, releases = 0;
  const query = async (sql, params) => {
    const result = await client.query(sql.replaceAll('public.', 'pg_temp.'), params);
    if (failSync && /DELETE FROM public.question_group_items/.test(sql)) {
      failSync = false;
      throw new Error('Injected failure after group membership replacement');
    }
    return result;
  };
  mock.module(new URL('../src/database/index.js', import.meta.url).href, { namedExports: { writePool: {
    query, async connect() { return { query, release() { releases++; } }; },
  } } });
  const { default: router } = await import('../src/modules/quizzes-engine/quizzes-engine.routes.js');
  const { syncQuestionGroupQuestionsInternal: sync } = await import('../src/modules/quizzes-engine/question-groups/handlers/syncQuestionGroupQuestions.js');
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'question-groups-test-secret';
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
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/quizzes/question-groups`;
  async function request(method, path = '', body, bearer = token) {
    const response = await fetch(baseUrl + path, {
      method, headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, ...await response.json() };
  }
  async function questionRequest(method, path = '', body) {
    const response = await fetch(baseUrl.replace(/question-groups$/, 'questions') + path, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, ...await response.json() };
  }
  const groupItems = async groupId => (await client.query(
    'SELECT question_id, ctid::text AS row_id FROM pg_temp.question_group_items WHERE group_id=$1 ORDER BY question_id', [groupId],
  )).rows;
  async function scenario(name, run) {
    await t.test(name, async () => {
      await client.query('TRUNCATE pg_temp.question_groups CASCADE');
      await run();
    });
  }

  await scenario('all group endpoints require access tokens', async () => {
    const temporary = jwt.sign({ sub: userId, purpose: 'two_factor' }, process.env.JWT_SECRET);
    for (const [method, path] of [['POST', ''], ['GET', ''], ['GET', `/${randomUUID()}`], ['PATCH', `/${randomUUID()}`], ['DELETE', `/${randomUUID()}`], ['PUT', `/${randomUUID()}/questions`]]) {
      assert.equal((await request(method, path, undefined, null)).status, 401);
      assert.equal((await request(method, path, undefined, temporary)).status, 401);
    }
  });

  await scenario('creates and reads groups using the authenticated owner and nullable descriptions', async () => {
    const created = await request('POST', '', { name: ' Languages ', description: ' Practice ' });
    assert.equal(created.status, 201); assert.equal(created.success, true);
    assert.deepEqual(created.group, { id: created.group.id, user_id: userId, name: 'Languages', description: 'Practice' });
    assert.deepEqual((await request('GET', `/${created.group.id}`)).group, created.group);
    const noDescription = await request('POST', '', { name: 'x'.repeat(255) });
    assert.equal(noDescription.status, 201); assert.equal(noDescription.group.description, null);
  });

  await scenario('foreign and nonexistent groups return 404 without modifying another owner’s data', async () => {
    const { group } = await request('POST', '', { name: 'Private' });
    for (const groupId of [group.id, randomUUID()]) {
      assert.equal((await request('GET', `/${groupId}`, undefined, otherToken)).status, 404);
      assert.equal((await request('PATCH', `/${groupId}`, { name: 'Stolen' }, otherToken)).status, 404);
      assert.equal((await request('DELETE', `/${groupId}`, undefined, otherToken)).status, 404);
    }
    assert.deepEqual((await request('GET', `/${group.id}`)).group, group);
  });

  await scenario('PATCH preserves omitted fields, allows clearing description and keeps ownership fixed', async () => {
    const { group } = await request('POST', '', { name: 'Languages', description: 'Practice' });
    const renamed = await request('PATCH', `/${group.id}`, { name: ' Updated ' });
    assert.equal(renamed.status, 200);
    assert.deepEqual(renamed.group, { ...group, name: 'Updated' });
    const cleared = await request('PATCH', `/${group.id}`, { description: null });
    assert.deepEqual(cleared.group, { ...group, name: 'Updated', description: null });
    const responses = await Promise.all([
      request('PATCH', `/${group.id}`, { name: 'Concurrent name' }),
      request('PATCH', `/${group.id}`, { description: 'Concurrent description' }),
    ]);
    assert.ok(responses.every(response => response.status === 200));
    assert.deepEqual((await request('GET', `/${group.id}`)).group,
      { ...group, name: 'Concurrent name', description: 'Concurrent description' });
  });

  await scenario('duplicate create and rename return 409 while different users can reuse a name', async () => {
    const first = await request('POST', '', { name: 'Alpha' });
    const second = await request('POST', '', { name: 'Beta' });
    assert.equal((await request('POST', '', { name: ' Alpha ' })).status, 409);
    assert.equal((await request('PATCH', `/${second.group.id}`, { name: 'Alpha' })).status, 409);
    assert.deepEqual((await request('GET', `/${second.group.id}`)).group, second.group);
    assert.equal((await request('POST', '', { name: 'Alpha' }, otherToken)).status, 201);
    assert.equal((await request('POST', '', { name: 'alpha' })).status, 201);
    assert.equal((await request('PATCH', `/${first.group.id}`, { name: 'Alpha' })).status, 200);
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
    assert.equal(filtered.groups[0].name, 'Advanced JavaScript');
    const second = await request('GET', '?name=javascript&limit=1&page=2');
    assert.equal(second.groups[0].name, 'JavaScript Basics');
    assert.equal(second.pagination.hasPreviousPage, true); assert.equal(second.pagination.hasNextPage, false);
    const reversed = await request('GET', '?name=javascript&sortOrder=desc');
    assert.deepEqual(reversed.groups.map(group => group.name), ['JavaScript Basics', 'Advanced JavaScript']);
    for (const [filter, expected] of [['%', 'Rates 100%'], ['_', 'under_score'], ['\\', 'back\\slash']]) {
      const response = await request('GET', `?name=${encodeURIComponent(filter)}`);
      assert.equal(response.pagination.total, 1); assert.equal(response.groups[0].name, expected);
    }
    const empty = await request('GET', `?name=${encodeURIComponent("' OR true --")}`);
    assert.deepEqual(empty.groups, []);
    assert.deepEqual(empty.pagination, { page: 1, limit: 20, total: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false });
    const all = await request('GET', '?name=%20');
    assert.equal(all.pagination.total, names.length); assert.ok(all.groups.every(group => group.user_id === userId));
    const beyond = await request('GET', '?page=100&limit=1');
    assert.deepEqual(beyond.groups, []); assert.equal(beyond.pagination.total, names.length);
    assert.equal(beyond.pagination.hasPreviousPage, true); assert.equal(beyond.pagination.hasNextPage, false);
  });

  await scenario('name and UUID sorting support both asc and desc', async () => {
    const groups = [];
    for (const name of ['Gamma', 'Alpha', 'Beta']) groups.push((await request('POST', '', { name })).group);
    for (const sortBy of ['name', 'id']) {
      const expected = groups.slice().sort((a, b) => a[sortBy] < b[sortBy] ? -1 : 1).map(group => group.id);
      for (const sortOrder of ['asc', 'desc']) {
        const result = await request('GET', `?sortBy=${sortBy}&sortOrder=${sortOrder}`);
        assert.deepEqual(result.sorting, { sortBy, sortOrder });
        assert.deepEqual(result.groups.map(group => group.id), sortOrder === 'asc' ? expected : [...expected].reverse());
      }
    }
  });

  await scenario('invalid metadata and membership payloads return 400, and membership POST is not registered', async () => {
    for (const [method, path, body] of [
      ['POST', '', {}], ['POST', '', { name: ' ' }], ['POST', '', { name: 'x'.repeat(256) }],
      ['POST', '', { name: 'A', user_id: otherUserId }], ['POST', '', { name: 'A', question_ids: [] }],
      ['GET', '/invalid'], ['DELETE', '/invalid'], ['PATCH', '/invalid', { name: 'A' }],
      ['PATCH', `/${randomUUID()}`, {}], ['PATCH', `/${randomUUID()}`, { questions: [] }],
      ['GET', '?page=0'], ['GET', '?limit=101'], ['GET', '?offset=0'],
      ['GET', '?sortBy=invalid'], ['GET', '?sortOrder=invalid'],
    ]) assert.equal((await request(method, path, body)).status, 400, `${method} ${path}`);
    const response = await fetch(`${baseUrl}/${randomUUID()}/questions`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 404);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_temp.question_groups')).rows[0].n, 0);
  });

  await scenario('deleting a group clears its memberships and preserves questions and other groups', async () => {
    const { group } = await request('POST', '', { name: 'Delete me' });
    const { group: retained } = await request('POST', '', { name: 'Keep me' });
    const { rows: [question] } = await client.query("INSERT INTO pg_temp.questions(user_id,type,content) VALUES ($1,'single_choice','Preserve me') RETURNING id", [userId]);
    // Seed existing memberships directly; no membership API is introduced.
    await client.query('INSERT INTO pg_temp.question_group_items VALUES ($1,$3),($2,$3)', [group.id, retained.id, question.id]);
    assert.deepEqual(await request('DELETE', `/${group.id}`), { status: 200, success: true, deleted: true });
    assert.equal((await request('GET', `/${group.id}`)).status, 404);
    assert.equal((await request('DELETE', `/${group.id}`)).status, 404);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_temp.question_group_items WHERE group_id=$1', [group.id])).rows[0].n, 0);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_temp.questions WHERE id=$1', [question.id])).rows[0].n, 1);
    assert.deepEqual((await request('GET', `/${retained.id}`)).group, retained);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_temp.question_group_items WHERE group_id=$1', [retained.id])).rows[0].n, 1);
  });

  await scenario('membership PUT adds, retains, removes and clears all question types without changing questions or other groups', async () => {
    const { group } = await request('POST', '', { name: 'Target' });
    const { group: other } = await request('POST', '', { name: 'Other' });
    const questions = [];
    for (const type of ['single_choice', 'multiple_choice', 'matching']) {
      const body = type === 'matching'
        ? { type, content: 'Match', matching_options: [{ option_no: 1, content: 'Answer', position: 1 }],
          matching_items: [{ item_no: 1, content: 'Item', correct_option_no: 1, position: 1 }] }
        : { type, content: 'Choose', options: [{ option_no: 1, content: 'Answer', is_correct: true, position: 1 }] };
      const created = await questionRequest('POST', '', { ...body, group_ids: type === 'single_choice' ? [other.id] : [] });
      assert.equal(created.status, 201); questions.push(created.question);
    }
    const ids = questions.map(question => question.id);
    const response = await request('PUT', `/${group.id}/questions`, { question_ids: [ids[2], ids[0], ids[1], ids[0].toUpperCase()] });
    assert.deepEqual(response, { status: 200, success: true, group, question_ids: ids.slice().sort() });
    const before = await groupItems(group.id);
    const replaced = await request('PUT', `/${group.id}/questions`, { question_ids: ids.slice(1) });
    assert.deepEqual(replaced.question_ids, ids.slice(1).sort());
    const retained = await groupItems(group.id);
    for (const item of retained) assert.equal(item.row_id, before.find(previous => previous.question_id === item.question_id).row_id);
    assert.deepEqual((await groupItems(other.id)).map(item => item.question_id), [ids[0]]);
    assert.equal((await request('PUT', `/${group.id}/questions`, { question_ids: ids.slice(1) })).status, 200);
    assert.deepEqual(await groupItems(group.id), retained);
    const cleared = await request('PUT', `/${group.id}/questions`, { question_ids: [] });
    assert.deepEqual(cleared, { status: 200, success: true, group, question_ids: [] });
    assert.deepEqual(await groupItems(group.id), []);
    for (const question of questions) assert.deepEqual((await questionRequest('GET', `/${question.id}`)).question, question);
    assert.deepEqual((await request('GET', `/${group.id}`)).group, group);
  });

  await scenario('group and question-side membership operations agree on the same many-to-many links', async () => {
    const { group: first } = await request('POST', '', { name: 'First' });
    const { group: second } = await request('POST', '', { name: 'Second' });
    const created = await questionRequest('POST', '', { type: 'single_choice', content: 'Draft', group_ids: [second.id] });
    const questionId = created.question.id;
    assert.equal((await request('PUT', `/${first.id}/questions`, { question_ids: [questionId] })).status, 200);
    assert.deepEqual((await questionRequest('GET', `/${questionId}`)).question.group_ids, [first.id, second.id].sort());
    assert.equal((await questionRequest('PATCH', `/${questionId}`, { group_ids: [first.id] })).status, 200);
    assert.deepEqual(await groupItems(second.id), []);
    assert.equal((await request('PUT', `/${first.id}/questions`, { question_ids: [] })).status, 200);
    assert.deepEqual((await questionRequest('GET', `/${questionId}`)).question.group_ids, []);
    assert.equal((await questionRequest('PATCH', `/${questionId}`, { group_ids: [first.id, second.id] })).status, 200);
    assert.equal((await request('PUT', `/${first.id}/questions`, { question_ids: [questionId] })).status, 200);
    assert.deepEqual((await groupItems(second.id)).map(item => item.question_id), [questionId]);
  });

  await scenario('missing and foreign groups/questions reject the entire membership replacement', async () => {
    const { group } = await request('POST', '', { name: 'Private target' });
    const { group: foreignGroup } = await request('POST', '', { name: 'Foreign target' }, otherToken);
    const old = (await questionRequest('POST', '', { type: 'single_choice', content: 'Old', group_ids: [group.id] })).question;
    const added = (await questionRequest('POST', '', { type: 'single_choice', content: 'New' })).question;
    const foreignQuestion = (await client.query("INSERT INTO pg_temp.questions(user_id,type,content) VALUES ($1,'matching','Foreign') RETURNING id", [otherUserId])).rows[0].id;
    const before = await groupItems(group.id);
    for (const invalidQuestion of [foreignQuestion, randomUUID()]) {
      assert.equal((await request('PUT', `/${group.id}/questions`, { question_ids: [added.id, invalidQuestion] })).status, 404);
      assert.deepEqual(await groupItems(group.id), before);
      assert.deepEqual((await questionRequest('GET', `/${old.id}`)).question, old);
      assert.deepEqual((await questionRequest('GET', `/${added.id}`)).question, added);
    }
    for (const groupId of [foreignGroup.id, randomUUID()]) {
      assert.equal((await request('PUT', `/${groupId}/questions`, { question_ids: [added.id] })).status, 404);
      assert.equal((await request('PUT', `/${groupId}/questions`, { question_ids: [] })).status, 404);
    }
    assert.equal((await request('PUT', `/${group.id}/questions`, { question_ids: [foreignQuestion] }, otherToken)).status, 404);
    assert.deepEqual(await groupItems(group.id), before);
  });

  await scenario('membership PUT rejects omitted, malformed or spoofed bodies instead of accidentally clearing a group', async () => {
    const { group } = await request('POST', '', { name: 'Validation target' });
    const question = (await questionRequest('POST', '', { type: 'single_choice', content: 'Preserve', group_ids: [group.id] })).question;
    const before = await groupItems(group.id);
    for (const body of [undefined, null, [], {}, { question_ids: null }, { question_ids: question.id },
      { question_ids: ['invalid'] }, { question_ids: [], user_id: otherUserId }, { question_ids: [], name: 'Rename' }]) {
      assert.equal((await request('PUT', `/${group.id}/questions`, body)).status, 400);
      assert.deepEqual(await groupItems(group.id), before);
    }
    assert.equal((await request('PUT', '/invalid/questions', { question_ids: [] })).status, 400);
  });

  await scenario('membership replacement failure rolls back inserted and removed links and releases the connection', async () => {
    const { group } = await request('POST', '', { name: 'Rollback target' });
    const old = (await questionRequest('POST', '', { type: 'single_choice', content: 'Old', group_ids: [group.id] })).question;
    const added = (await questionRequest('POST', '', { type: 'single_choice', content: 'New' })).question;
    const before = await groupItems(group.id), releasedBefore = releases;
    failSync = true;
    await assert.rejects(sync({ groupId: group.id }, { question_ids: [added.id] }, userId), /Injected failure after group membership replacement/);
    assert.equal(releases, releasedBefore + 1);
    assert.deepEqual(await groupItems(group.id), before);
    assert.deepEqual((await questionRequest('GET', `/${old.id}`)).question, old);
    assert.deepEqual((await questionRequest('GET', `/${added.id}`)).question, added);
    const retry = await request('PUT', `/${group.id}/questions`, { question_ids: [added.id] });
    assert.deepEqual(retry.question_ids, [added.id]);
  });
});
