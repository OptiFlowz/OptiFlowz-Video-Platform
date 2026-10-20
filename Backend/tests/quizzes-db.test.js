import { upgradeFixedQuizLayout } from './helpers/fixed-quiz-schema.js';
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

test('quiz settings migration preserves existing quizzes, enforces database constraints and supports rollback', {
  skip: !process.env.TEST_DATABASE_URL,
}, async t => {
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  await client.connect();
  t.after(() => client.end());
  await client.query('CREATE TEMP TABLE users (id uuid PRIMARY KEY)');
  const readMigration = async file => (await readFile(new URL(`../src/database/migrations/${file}`, import.meta.url), 'utf8'))
    .replaceAll('public.', 'pg_temp.').split('-- Down Migration');
  const [baseUp] = await readMigration('1791590400004_add-quizzes.sql');
  const [up, down] = await readMigration('1792195200000_add-quiz-feedback-and-scoring-settings.sql');
  await client.query(baseUp);
  const userId = randomUUID();
  await client.query('INSERT INTO pg_temp.users(id) VALUES ($1)', [userId]);
  const insert = () => client.query("INSERT INTO pg_temp.quizzes(user_id,title,question_count) VALUES ($1,'Existing quiz',5) RETURNING *", [userId]);
  const before = (await insert()).rows[0];
  await client.query(up);
  const defaults = {
    min_answered_percentage: '0.00', min_correct_percentage: '0.00',
    correctness_visibility: 'after_finish', correct_answers_visibility: 'after_finish', explanation_visibility: 'after_finish',
    explanation_incorrect_only: false, allow_answer_changes_after_check: false,
    allow_attempt_review: true, show_final_score: true, scoring_mode: 'exact_match',
  };
  assert.deepEqual((await client.query('SELECT * FROM pg_temp.quizzes WHERE id=$1', [before.id])).rows[0], { ...before, ...defaults });
  const fresh = (await insert()).rows[0];
  for (const [field, value] of Object.entries(defaults)) {
    assert.equal(fresh[field], value);
    await assert.rejects(client.query(`UPDATE pg_temp.quizzes SET ${field}=NULL`), { code: '23502' });
  }
  for (const field of ['min_answered_percentage', 'min_correct_percentage']) {
    for (const value of [-0.01, 100.01]) {
      await assert.rejects(client.query(`UPDATE pg_temp.quizzes SET ${field}=$1`, [value]), { code: '23514' });
    }
    for (const value of [0, 0.29, 75.25, 100]) {
      await client.query(`UPDATE pg_temp.quizzes SET ${field}=$1`, [value]);
      assert.equal(Number((await client.query(`SELECT ${field} FROM pg_temp.quizzes`)).rows[0][field]), value);
    }
  }
  for (const field of ['correctness_visibility', 'correct_answers_visibility', 'explanation_visibility']) {
    for (const value of ['never', 'after_check', 'after_finish']) await client.query(`UPDATE pg_temp.quizzes SET ${field}=$1`, [value]);
    await assert.rejects(client.query(`UPDATE pg_temp.quizzes SET ${field}='invalid'`), { code: '22P02' });
  }
  for (const value of ['exact_match', 'partial_credit']) await client.query('UPDATE pg_temp.quizzes SET scoring_mode=$1', [value]);
  await assert.rejects(client.query("UPDATE pg_temp.quizzes SET scoring_mode='invalid'"), { code: '22P02' });
  await client.query(down);
  assert.deepEqual((await client.query('SELECT * FROM pg_temp.quizzes WHERE id=$1', [before.id])).rows[0], before);
  assert.deepEqual((await client.query("SELECT to_regtype('pg_temp.feedback_visibility') AS feedback, to_regtype('pg_temp.quiz_scoring_mode') AS scoring")).rows[0],
    { feedback: null, scoring: null });
  await client.query(up);
  assert.deepEqual((await client.query('SELECT * FROM pg_temp.quizzes WHERE id=$1', [before.id])).rows[0], { ...before, ...defaults });
});

test('quiz CRUD and existing submodule routing against PostgreSQL session-local tables', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  await client.connect();
  t.after(() => client.end());
  await client.query("CREATE TEMP TABLE users (id uuid PRIMARY KEY, status text DEFAULT 'active', authz_version integer DEFAULT 1)");
  for (const file of ['1791590400001_add-questions.sql', '1791590400002_add-question-timestamps.sql', '1791590400003_add-question-groups.sql', '1791590400004_add-quizzes.sql',
    '1792195200000_add-quiz-feedback-and-scoring-settings.sql']) {
    const sql = await readFile(new URL(`../src/database/migrations/${file}`, import.meta.url), 'utf8');
    await client.query(sql.split('-- Down Migration')[0].replaceAll('public.', 'pg_temp.'));
  }
  const userId = randomUUID(), otherUserId = randomUUID();
  await client.query('INSERT INTO pg_temp.users(id) VALUES ($1),($2)', [userId, otherUserId]);
  await installQuizPermissions(client);
  await upgradeQuestionCategories(client);
  await upgradeFixedQuizLayout(client);
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
    await t.test(name, async () => { await client.query('TRUNCATE pg_temp.quiz_sources, pg_temp.quiz_questions, pg_temp.quizzes'); await run(); });
  }
  const minimal = { title: 'Quiz' };

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
    assert.deepEqual(quiz, { id: quiz.id, user_id: userId, ...minimal, question_count: 0, description: null, status: 'draft',
      time_limit_seconds: null, max_attempts: null, passing_score_percentage: 50, shuffle_questions: true,
      shuffle_options: true, has_certificate: false,
      min_answered_percentage: 0, min_correct_percentage: 0,
      correctness_visibility: 'after_finish', correct_answers_visibility: 'after_finish', explanation_visibility: 'after_finish',
      explanation_incorrect_only: false, allow_answer_changes_after_check: false,
      allow_attempt_review: true, show_final_score: true, scoring_mode: 'exact_match',
      created_at: quiz.created_at, updated_at: quiz.updated_at });
    assert.equal(quiz.created_at, quiz.updated_at); assert.ok(Number.isFinite(Date.parse(quiz.created_at)));
    assert.deepEqual((await request('GET', `/${quiz.id}`)).quiz, quiz);
    assert.equal((await request('POST', '', minimal)).status, 201);
    const configured = { title: 'Configured', description: ' Details ', status: 'published',
      time_limit_seconds: 600, max_attempts: 3, passing_score_percentage: 75.25,
      shuffle_questions: false, shuffle_options: false, has_certificate: true };
    const saved = await request('POST', '', configured);
    assert.equal(saved.status, 201);
    for (const [field, value] of Object.entries(configured)) assert.equal(saved.quiz[field], field === 'description' ? 'Details' : value);
    assert.equal(typeof saved.quiz.passing_score_percentage, 'number');
  });

  await scenario('new quiz settings round-trip through create, PATCH, detail and list without resetting omitted fields', async () => {
    const normalizeTimestamps = quiz => ({ ...quiz,
      created_at: new Date(quiz.created_at).toISOString(), updated_at: new Date(quiz.updated_at).toISOString() });
    const settings = {
      min_answered_percentage: 75.25, min_correct_percentage: 0.29,
      correctness_visibility: 'after_check', correct_answers_visibility: 'never', explanation_visibility: 'after_check',
      explanation_incorrect_only: true, allow_answer_changes_after_check: true,
      allow_attempt_review: false, show_final_score: false, scoring_mode: 'partial_credit',
    };
    const created = await request('POST', '', { ...minimal, ...settings });
    assert.equal(created.status, 201);
    for (const [key, value] of Object.entries(settings)) assert.equal(created.quiz[key], value);
    const path = `/${created.quiz.id}`;
    assert.deepEqual((await request('GET', path)).quiz, created.quiz);
    assert.deepEqual((await request('GET', '')).quizzes.map(normalizeTimestamps), [created.quiz]);
    const renamed = await request('PATCH', path, { title: 'Renamed' });
    assert.equal(renamed.status, 200);
    for (const [key, value] of Object.entries(settings)) assert.equal(renamed.quiz[key], value);
    const changes = {
      min_answered_percentage: 0, min_correct_percentage: 100,
      correctness_visibility: 'never', correct_answers_visibility: 'after_check', explanation_visibility: 'after_finish',
      explanation_incorrect_only: false, allow_answer_changes_after_check: false,
      allow_attempt_review: true, show_final_score: true, scoring_mode: 'exact_match',
    };
    const updated = await request('PATCH', path, changes);
    assert.equal(updated.status, 200);
    assert.deepEqual(updated.quiz, { ...renamed.quiz, ...changes, updated_at: updated.quiz.updated_at });
    assert.deepEqual((await request('GET', path)).quiz, updated.quiz);
    assert.deepEqual((await request('GET', '')).quizzes.map(normalizeTimestamps), [updated.quiz]);
    assert.equal((await request('PATCH', path, { scoring_mode: 'partial_credit' }, otherToken)).status, 404);
    for (const invalid of [
      { min_answered_percentage: -1 }, { min_correct_percentage: 100.01 }, { min_answered_percentage: 1.001 },
      { correctness_visibility: 'always' }, { correct_answers_visibility: null }, { explanation_visibility: 'AFTER_CHECK' },
      { explanation_incorrect_only: 'false' }, { allow_answer_changes_after_check: 1 },
      { allow_attempt_review: null }, { show_final_score: 'true' }, { scoring_mode: 'invalid' },
    ]) {
      assert.equal((await request('POST', '', { ...minimal, ...invalid })).status, 400);
      assert.equal((await request('PATCH', path, { title: 'Must not change', ...invalid })).status, 400);
    }
    assert.deepEqual((await request('GET', path)).quiz, updated.quiz);
    assert.equal((await request('GET', '')).pagination.total, 1);
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
     ]) {
      const { question_count, ...body } = entry;
      const created = (await request('POST', '', body)).quiz;
      await client.query('INSERT INTO pg_temp.quiz_sources(quiz_id,category_id,question_count) VALUES($1,NULL,$2)',[created.id,question_count]);
      quizzes.push((await request('GET',`/${created.id}`)).quiz);
    }
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
    const { quiz: existing } = await request('POST', '', minimal);
    for (const [method, path, payload] of [
      ['POST', '', {}], ['POST', '', { ...minimal, question_count: 0 }], ['POST', '', { ...minimal, max_attempts: 0 }],
      ['POST', '', { ...minimal, passing_score_percentage: 100.01 }], ['POST', '', { ...minimal, passing_score_percentage: 50.555 }],
      ['POST', '', { ...minimal, user_id: otherUserId }], ['POST', '', { ...minimal, category_ids: [] }],
      ['PATCH', `/${existing.id}`, {}], ['PATCH', `/${existing.id}`, { updated_at: '2026-01-01' }],
      ['PATCH', `/${existing.id}`, { time_limit_seconds: -1 }], ['GET', '/invalid'], ['DELETE', '/invalid'],
      ['GET', '?page=0'], ['GET', '?limit=101'], ['GET', '?status=invalid'],
      ['GET', '?sortBy=invalid'], ['GET', '?sortOrder=invalid'], ['GET', '?offset=0'],
    ]) assert.equal((await request(method, path, payload)).status, 400, `${method} ${path}`);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_temp.quizzes')).rows[0].n, 1);
  });

  await scenario('quiz deletion is owner scoped and preserves questions/categories submodule routes', async () => {
    const { quiz } = await request('POST', '', minimal);
    assert.deepEqual(await request('DELETE', `/${quiz.id}`), { status: 200, success: true, deleted: true });
    assert.equal((await request('GET', `/${quiz.id}`)).status, 404);
    assert.equal((await request('DELETE', `/${quiz.id}`)).status, 404);
    const questions = await request('GET', '/questions');
    const categories = await request('GET', '/question-categories');
    assert.equal(questions.status, 200); assert.deepEqual(questions.questions, []);
    assert.equal(categories.status, 200); assert.deepEqual(categories.categories, []);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_temp.quizzes')).rows[0].n, 0);
  });
});
