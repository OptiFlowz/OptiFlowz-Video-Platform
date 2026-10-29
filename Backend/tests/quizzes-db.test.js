import { upgradeFixedQuizLayout } from './helpers/fixed-quiz-schema.js';
import { upgradeQuizCertificates } from './helpers/quiz-certificate-schema.js';
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

test('certificate migration preserves configured IDs, leaves legacy flags unconfigured and nulls deleted references', {
  skip: !process.env.TEST_DATABASE_URL,
}, async t => {
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  t.after(() => client.end());
  await client.query('CREATE TEMP TABLE certificate_templates (id uuid PRIMARY KEY)');
  await client.query('CREATE TEMP TABLE quizzes (id uuid PRIMARY KEY, has_certificate boolean NOT NULL DEFAULT false)');
  // Also cover environments that already added the column and an old FK manually.
  await client.query(`ALTER TABLE pg_temp.quizzes ADD COLUMN certificate_template_id uuid
    CONSTRAINT quizzes_certificate_template_id_fkey REFERENCES pg_temp.certificate_templates(id) ON DELETE RESTRICT`);
  const templateId = randomUUID(), configured = randomUUID(), legacy = randomUUID(), disabled = randomUUID();
  await client.query('INSERT INTO pg_temp.certificate_templates VALUES ($1)', [templateId]);
  await client.query('INSERT INTO pg_temp.quizzes VALUES ($1,false,$2),($3,true,NULL),($4,false,NULL)',
    [configured, templateId, legacy, disabled]);
  const [up, down] = (await readFile(new URL('../src/database/migrations/1792926000000_quiz-certificate-template.sql', import.meta.url), 'utf8'))
    .replaceAll('public.', 'pg_temp.').split('-- Down Migration');
  await client.query(up);
  let rows = (await client.query('SELECT * FROM pg_temp.quizzes')).rows;
  assert.ok(rows.every(row => !Object.hasOwn(row, 'has_certificate')));
  assert.equal(rows.find(row => row.id === configured).certificate_template_id, templateId);
  for (const id of [legacy, disabled]) assert.equal(rows.find(row => row.id === id).certificate_template_id, null);
  await assert.rejects(client.query('UPDATE pg_temp.quizzes SET certificate_template_id=$1 WHERE id=$2', [randomUUID(), legacy]), { code: '23503' });
  await client.query(down);
  rows = (await client.query('SELECT * FROM pg_temp.quizzes')).rows;
  assert.equal(rows.find(row => row.id === configured).has_certificate, true);
  assert.equal(rows.find(row => row.id === legacy).has_certificate, false);
  assert.ok(rows.every(row => !Object.hasOwn(row, 'certificate_template_id')));
  // This time Up must create the missing column itself.
  await client.query(up);
  await client.query('UPDATE pg_temp.quizzes SET certificate_template_id=$1 WHERE id=$2', [templateId, configured]);
  await client.query('DELETE FROM pg_temp.certificate_templates WHERE id=$1', [templateId]);
  assert.equal((await client.query('SELECT certificate_template_id FROM pg_temp.quizzes WHERE id=$1', [configured])).rows[0].certificate_template_id, null);
});

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
  const [pageUp, pageDown] = await readMigration('1792627200001_add-quiz-questions-per-page.sql');
  await client.query(pageUp);
  assert.equal((await client.query('SELECT questions_per_page FROM pg_temp.quizzes WHERE id=$1', [before.id])).rows[0].questions_per_page, 1);
  assert.equal((await insert()).rows[0].questions_per_page, 1);
  await assert.rejects(client.query('UPDATE pg_temp.quizzes SET questions_per_page=NULL'), { code: '23502' });
  for (const value of [0, -1]) {
    await assert.rejects(client.query('UPDATE pg_temp.quizzes SET questions_per_page=$1', [value]), { code: '23514' });
  }
  await client.query(pageDown);
  assert.deepEqual((await client.query('SELECT * FROM pg_temp.quizzes WHERE id=$1', [before.id])).rows[0], { ...before, ...defaults });
  await client.query(pageUp);
});

test('quiz CRUD and existing submodule routing against PostgreSQL session-local tables', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  await client.connect();
  t.after(() => client.end());
  await client.query("CREATE TEMP TABLE users (id uuid PRIMARY KEY, status text DEFAULT 'active', authz_version integer DEFAULT 1)");
  for (const file of ['1791590400001_add-questions.sql', '1791590400002_add-question-timestamps.sql', '1791590400003_add-question-groups.sql', '1791590400004_add-quizzes.sql',
    '1792195200000_add-quiz-feedback-and-scoring-settings.sql', '1792627200001_add-quiz-questions-per-page.sql', '1793232000001_add-quiz-thumbnail.sql']) {
    const sql = await readFile(new URL(`../src/database/migrations/${file}`, import.meta.url), 'utf8');
    await client.query(sql.split('-- Down Migration')[0].replaceAll('public.', 'pg_temp.'));
  }
  const userId = randomUUID(), otherUserId = randomUUID();
  await client.query('INSERT INTO pg_temp.users(id) VALUES ($1),($2)', [userId, otherUserId]);
  await installQuizPermissions(client);
  await upgradeQuestionCategories(client);
  await upgradeFixedQuizLayout(client);
  await upgradeQuizCertificates(client);
  const templateId = (await client.query('SELECT id FROM pg_temp.certificate_templates WHERE is_default=true')).rows[0].id;
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

  await scenario('participants browse published quizzes from every author without author read access', async () => {
    const viewer = randomUUID(), denied = randomUUID(), owner = randomUUID();
    await client.query('INSERT INTO pg_temp.users(id) VALUES ($1),($2),($3)', [viewer, denied, owner]);
    await client.query("INSERT INTO pg_temp.user_roles(user_id,role_id) SELECT $1,id FROM pg_temp.roles WHERE name='Viewer'", [viewer]);
    await client.query("INSERT INTO pg_temp.user_roles(user_id,role_id) SELECT $1,id FROM pg_temp.roles WHERE name='Owner'", [owner]);
    const bearer = id => jwt.sign({ sub: id, authzVersion: 1 }, process.env.JWT_SECRET);
    const published = (await request('POST', '', { title: 'Published', status: 'published', questions_per_page: 5,
      certificate_template_id: templateId, min_answered_percentage: 100, max_attempts: 1 })).quiz;
    const foreign = (await request('POST', '', { title: 'Foreign published', status: 'published' }, otherToken)).quiz;
    const draft = (await request('POST', '', { title: 'Draft' })).quiz;
    const archived = (await request('POST', '', { title: 'Archived', status: 'archived' })).quiz;
    const paths = ['/published', `/published/${published.id}`];
    const temporary = jwt.sign({ sub: viewer, purpose: 'two_factor' }, process.env.JWT_SECRET);
    for (const path of paths) {
      assert.equal((await request('GET', path, undefined, null)).status, 401);
      assert.equal((await request('GET', path, undefined, temporary)).status, 401);
      assert.equal((await request('GET', path, undefined, bearer(denied))).status, 403);
    }
    assert.equal((await request('GET', '', undefined, bearer(viewer))).status, 403);
    assert.equal((await request('GET', `/${published.id}`, undefined, bearer(viewer))).status, 403);
    const listed = await request('GET', '/published', undefined, bearer(viewer));
    assert.equal(listed.status, 200);
    assert.deepEqual(new Set(listed.quizzes.map(q => q.id)), new Set([published.id, foreign.id]));
    const detail = await request('GET', `/published/${published.id}`, undefined, bearer(viewer));
    assert.equal(detail.status, 200);
    const listItem = listed.quizzes.find(q => q.id === published.id);
    // JSONB aggregation preserves PostgreSQL timezone/precision; detail uses pg Dates.
    for (const key of ['created_at', 'updated_at']) listItem[key] = new Date(listItem[key]).toISOString();
    assert.deepEqual(detail.quiz, listItem);
    assert.equal(detail.quiz.questions_per_page, 5);
    assert.equal(detail.quiz.has_certificate, true);
    assert.equal(listed.quizzes.find(q => q.id === foreign.id).has_certificate, false);
    assert.equal(detail.quiz.min_answered_percentage, 100);
    assert.equal(detail.quiz.passing_score_percentage, 50);
    for (const key of ['user_id', 'certificate_template_id', 'questions', 'sources', 'settings_snapshot']) {
      assert.equal(Object.hasOwn(detail.quiz, key), false);
    }
    // Participant-only publication scope applies to authors and Owners too.
    for (const actor of [token, bearer(viewer), bearer(owner)]) {
      for (const id of [draft.id, archived.id, randomUUID()]) {
        assert.equal((await request('GET', `/published/${id}`, undefined, actor)).status, 404);
      }
      assert.equal((await request('GET', '/published', undefined, actor)).pagination.total, 2);
    }
    assert.equal((await request('GET', `/${draft.id}`)).status, 200);
    const response = await fetch(`${baseUrl}/published/${published.id}`, { headers: { Authorization: `Bearer ${bearer(viewer)}` } });
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    await response.json();
    await request('PATCH', `/${published.id}`, { status: 'draft' });
    assert.equal((await request('GET', `/published/${published.id}`, undefined, bearer(viewer))).status, 404);
    assert.equal((await request('GET', '/published', undefined, bearer(viewer))).pagination.total, 1);
  });

  await scenario('published list preserves pagination, literal title filters and stable sorting', async () => {
    const a = (await request('POST', '', { title: '100% Quiz', status: 'published' })).quiz;
    const b = (await request('POST', '', { title: '100% Quiz', status: 'published' }, otherToken)).quiz;
    await request('POST', '', { title: '100% Quiz', status: 'draft' });
    await request('POST', '', { title: 'Other', status: 'published' });
    const ids = [a.id, b.id].sort();
    const first = await request('GET', '/published?title=100%25&page=1&limit=1&sortBy=title&sortOrder=desc');
    assert.equal(first.status, 200);
    assert.equal(first.quizzes[0].id, ids[0]);
    assert.deepEqual(first.pagination, { page: 1, limit: 1, total: 2, totalPages: 2, hasNextPage: true, hasPreviousPage: false });
    assert.deepEqual(first.sorting, { sortBy: 'title', sortOrder: 'desc' });
    assert.equal((await request('GET', '/published?title=100%25&page=2&limit=1&sortBy=title&sortOrder=desc')).quizzes[0].id, ids[1]);
    const beyond = await request('GET', '/published?title=100%25&page=3&limit=1');
    assert.deepEqual(beyond.quizzes, []);
    assert.equal(beyond.pagination.total, 2);
    const empty = await request('GET', '/published?title=missing');
    assert.deepEqual(empty.quizzes, []);
    assert.equal(empty.pagination.total, 0);
    const asc = await request('GET', '/published?sortBy=title&sortOrder=asc&status=published');
    assert.deepEqual(asc.quizzes.map(q => q.title), ['100% Quiz', '100% Quiz', 'Other']);
    for (const query of ['status=draft', 'status=archived', 'status=invalid', 'limit=101', 'page=0',
      'sortBy=unknown', 'sortOrder=unknown', 'user_id=invalid', 'offset=0']) {
      assert.equal((await request('GET', `/published?${query}`)).status, 400, query);
    }
    const filtered = await request('GET', `/published?user_id=${userId.toUpperCase()}&title=100%25&limit=1`);
    assert.equal(filtered.status, 200);
    assert.deepEqual(filtered.quizzes.map(q => q.id), [a.id]);
    assert.equal(filtered.pagination.total, 1);
    assert.equal(filtered.pagination.totalPages, 1);
    const foreign = await request('GET', `/published?user_id=${otherUserId}`);
    assert.deepEqual(foreign.quizzes.map(q => q.id), [b.id]);
    const beyondUser = await request('GET', `/published?user_id=${otherUserId}&page=2&limit=1`);
    assert.deepEqual(beyondUser.quizzes, []);
    assert.equal(beyondUser.pagination.total, 1);
    const missingUser = await request('GET', `/published?user_id=${randomUUID()}`);
    assert.deepEqual(missingUser.quizzes, []);
    assert.equal(missingUser.pagination.total, 0);
    assert.equal((await request('GET', '/published/invalid')).status, 400);
  });

  await scenario('own-only author filtering cannot expose another author or their counts', async () => {
    const own = (await request('POST', '', { title: 'Mine', status: 'draft' })).quiz;
    await request('POST', '', { title: 'Other', status: 'published' }, otherToken);
    const mine = await request('GET', `?user_id=${userId.toUpperCase()}`);
    assert.equal(mine.status, 200);
    assert.deepEqual(mine.quizzes.map(q => q.id), [own.id]);
    assert.equal(mine.pagination.total, 1);
    for (const id of [otherUserId, randomUUID()]) {
      const filtered = await request('GET', `?user_id=${id}`);
      assert.equal(filtered.status, 200);
      assert.deepEqual(filtered.quizzes, []);
      assert.equal(filtered.pagination.total, 0);
    }
    for (const path of ['?user_id=invalid', '?user_id=', `?user_id=${userId}&user_id=${otherUserId}`]) {
      assert.equal((await request('GET', path)).status, 400);
    }
  });

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
    assert.deepEqual(quiz, { id: quiz.id, user_id: userId, ...minimal, thumbnail_url: null, question_count: 0, questions_per_page: 1, description: null, status: 'draft',
      time_limit_seconds: null, max_attempts: null, passing_score_percentage: 50, shuffle_questions: true,
      shuffle_options: true, certificate_template_id: null,
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
      shuffle_questions: false, shuffle_options: false, certificate_template_id: templateId };
    const saved = await request('POST', '', configured);
    assert.equal(saved.status, 201);
    for (const [field, value] of Object.entries(configured)) assert.equal(saved.quiz[field], field === 'description' ? 'Details' : value);
    assert.equal(typeof saved.quiz.passing_score_percentage, 'number');
  });

  await scenario('thumbnail URLs are returned and preserved by CRUD but changed only through upload', async () => {
    const created = await request('POST', '', minimal);
    const id = created.quiz.id, path = `/${id}`, url = `https://cdn.example.test/quiz-thumbnails/${id}/image.webp`;
    assert.equal(created.quiz.thumbnail_url, null);
    await client.query('UPDATE pg_temp.quizzes SET thumbnail_url=$2 WHERE id=$1', [id, url]);
    assert.equal((await request('PATCH', path, { title: 'Renamed' })).quiz.thumbnail_url, url);
    assert.equal((await request('GET', path)).quiz.thumbnail_url, url);
    assert.equal((await request('GET', '')).quizzes[0].thumbnail_url, url);
    assert.equal((await request('POST', '', { ...minimal, thumbnail_url: url })).status, 400);
    assert.equal((await request('PATCH', path, { thumbnail_url: null })).status, 400);
  });

  await scenario('questions_per_page is informational and round-trips through CRUD', async () => {
    const created = await request('POST', '', { title: 'Pages', questions_per_page: 7 });
    assert.equal(created.status, 201);
    assert.equal(created.quiz.questions_per_page, 7);
    assert.equal(created.quiz.question_count, 0);
    const path = `/${created.quiz.id}`;
    assert.equal((await request('PATCH', path, { questions_per_page: 3 })).quiz.questions_per_page, 3);
    assert.equal((await request('PATCH', path, { title: 'Renamed' })).quiz.questions_per_page, 3);
    assert.equal((await request('GET', path)).quiz.questions_per_page, 3);
    assert.equal((await request('GET')).quizzes.find(q => q.id === created.quiz.id).questions_per_page, 3);
  });

  await scenario('certificate assignment accepts own/system templates, rejects inaccessible IDs and supports clearing/deletion', async () => {
    const own = randomUUID(), foreign = randomUUID();
    await client.query(`INSERT INTO pg_temp.certificate_templates (id,user_id,name,html_template)
      VALUES ($1,$2,'Own','<p>Certificate</p>'),($3,$4,'Other','<p>Certificate</p>')`, [own, userId, foreign, otherUserId]);
    const created = await request('POST', '', { ...minimal, certificate_template_id: own });
    assert.equal(created.status, 201);
    assert.equal(created.quiz.certificate_template_id, own);
    const path = `/${created.quiz.id}`;
    for (const inaccessible of [foreign, randomUUID()]) {
      assert.equal((await request('POST', '', { ...minimal, certificate_template_id: inaccessible })).status, 422);
      assert.equal((await request('PATCH', path, { certificate_template_id: inaccessible })).status, 422);
    }
    assert.equal((await request('PATCH', path, { certificate_template_id: templateId })).quiz.certificate_template_id, templateId);
    assert.equal((await request('PATCH', path, { title: 'Still issues certificates' })).quiz.certificate_template_id, templateId);
    assert.equal((await request('GET', '')).quizzes[0].certificate_template_id, templateId);
    assert.equal((await request('PATCH', path, { certificate_template_id: null })).quiz.certificate_template_id, null);
    assert.equal((await request('PATCH', path, { certificate_template_id: own })).quiz.certificate_template_id, own);
    await client.query('DELETE FROM pg_temp.certificate_templates WHERE id=$1', [own]);
    assert.equal((await request('GET', path)).quiz.certificate_template_id, null);
    assert.equal((await request('PATCH', path, { certificate_template_id: templateId }, otherToken)).status, 404);
    for (const value of [true, false]) {
      assert.equal((await request('POST', '', { ...minimal, has_certificate: value })).status, 400);
      assert.equal((await request('PATCH', path, { has_certificate: value })).status, 400);
    }
  });

  await scenario('new quiz settings round-trip through create, PATCH, detail and list without resetting omitted fields', async () => {
    const normalizeTimestamps = quiz => ({ ...quiz,
      created_at: new Date(quiz.created_at).toISOString(), updated_at: new Date(quiz.updated_at).toISOString() });
    const settings = {
      questions_per_page: 5,
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
    const created = await request('POST', '', { ...minimal, description: 'Keep', time_limit_seconds: 600, max_attempts: 3, certificate_template_id: templateId });
    await client.query("UPDATE pg_temp.quizzes SET created_at='2026-01-01',updated_at='2026-01-01' WHERE id=$1", [created.quiz.id]);
    const original = (await request('GET', `/${created.quiz.id}`)).quiz;
    const renamed = await request('PATCH', `/${original.id}`, { title: ' Renamed ' });
    assert.equal(renamed.status, 200);
    assert.deepEqual(renamed.quiz, { ...original, title: 'Renamed', updated_at: renamed.quiz.updated_at });
    assert.ok(Date.parse(renamed.quiz.updated_at) > Date.parse(original.updated_at));
    const changes = { description: null, time_limit_seconds: null, max_attempts: null, passing_score_percentage: 0,
      shuffle_questions: false, shuffle_options: false, certificate_template_id: null, status: 'archived' };
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
