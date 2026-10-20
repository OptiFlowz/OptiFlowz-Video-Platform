import { installQuizPermissions } from './helpers/quiz-permissions-schema.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { mock, test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';

test('parallel candidate moves read positions after the quiz lock and preserve a serial ordering', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const schema = `quiz_move_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL, statement_timeout: 5000 });
  await admin.connect();
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 2, statement_timeout: 5000 });
  t.after(async () => {
    await pool.end();
    try { await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); } finally { await admin.end(); }
  });
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.query(`CREATE TABLE ${schema}.users(id uuid PRIMARY KEY)`);
  for (const file of ['1791590400001_add-questions.sql', '1791590400004_add-quizzes.sql', '1792281600000_add-quiz-questions.sql']) {
    const sql = (await readFile(new URL(`../src/database/migrations/${file}`, import.meta.url), 'utf8')).replaceAll('public.', `${schema}.`);
    await admin.query(sql.split('-- Down Migration')[0]);
  }
  const userId = randomUUID(), quizId = randomUUID(), ids = Array.from({ length: 4 }, () => randomUUID());
  await admin.query(`INSERT INTO ${schema}.users VALUES($1)`, [userId]);
  await admin.query(`INSERT INTO ${schema}.quizzes(id,user_id,title,question_count) VALUES($1,$2,'Quiz',4)`, [quizId, userId]);
  for (const [position, id] of ids.entries()) {
    await admin.query(`INSERT INTO ${schema}.questions(id,user_id,type,content) VALUES($1,$2,'single_choice','Question')`, [id, userId]);
    await admin.query(`INSERT INTO ${schema}.quiz_questions(quiz_id,question_id,position) VALUES($1,$2,$3)`, [quizId, id, position]);
  }
  const { getOwnedQuiz, updateQuizQuestion } = await import('../src/modules/quizzes-engine/quiz-questions/repository/quiz-questions.repository.js');
  const wrap = client => ({ query: (sql, params) => client.query(sql.replaceAll('public.', `${schema}.`), params) });
  const first = await pool.connect();
  const second = await pool.connect();
  try {
    await first.query('BEGIN');
    await getOwnedQuiz(wrap(first), quizId, userId, true);
    await second.query('BEGIN');
    const pending = (async () => {
      await getOwnedQuiz(wrap(second), quizId, userId, true);
      await updateQuizQuestion(wrap(second), quizId, ids[2], userId, { position: 1 });
      await second.query('COMMIT');
    })();
    await updateQuizQuestion(wrap(first), quizId, ids[3], userId, { position: 0 });
    await first.query('COMMIT');
    await pending;
    const { rows } = await admin.query(`SELECT question_id,position FROM ${schema}.quiz_questions ORDER BY position`);
    assert.deepEqual(rows.map(row => row.question_id), [ids[3], ids[2], ids[0], ids[1]]);
    assert.deepEqual(rows.map(row => row.position), [0, 1, 2, 3]);
  } finally {
    await first.query('ROLLBACK'); await second.query('ROLLBACK');
    first.release(); second.release();
  }
});

test('quiz candidate migration and CRUD against session-local PostgreSQL tables', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  await client.connect();
  t.after(() => client.end());
  await client.query('SET search_path TO pg_temp, public');
  await client.query("CREATE TEMP TABLE users (id uuid PRIMARY KEY, status text DEFAULT 'active', authz_version integer DEFAULT 1)");
  let migration;
  for (const file of ['1791590400001_add-questions.sql', '1791590400003_add-question-groups.sql', '1791590400004_add-quizzes.sql', '1792281600000_add-quiz-questions.sql']) {
    const sql = (await readFile(new URL(`../src/database/migrations/${file}`, import.meta.url), 'utf8')).replaceAll('public.', 'pg_temp.');
    await client.query(sql.split('-- Down Migration')[0]);
    migration = sql;
  }
  const owner = randomUUID(), other = randomUUID();
  await client.query('INSERT INTO users(id) VALUES ($1),($2)', [owner, other]);
  await installQuizPermissions(client);
  let failAfterInsert = false, failAfterMove = false, releases = 0;
  const query = async (sql, params) => {
    const result = await client.query(sql.replaceAll('public.', 'pg_temp.'), params);
    if (failAfterInsert && /INSERT INTO public.quiz_questions/.test(sql)) {
      failAfterInsert = false;
      throw new Error('Injected failure after insert');
    }
    if (failAfterMove && /WITH current_question AS/.test(sql)) {
      failAfterMove = false;
      throw new Error('Injected failure after move');
    }
    return result;
  };
  mock.module(new URL('../src/database/index.js', import.meta.url).href, { namedExports: { writePool: {
    query, async connect() { return { query, release() { releases++; } }; },
  } } });
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'quiz-questions-test-secret';
  t.after(() => { if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret; });
  const token = jwt.sign({ sub: owner, authzVersion: 1 }, process.env.JWT_SECRET);
  const otherToken = jwt.sign({ sub: other, authzVersion: 1 }, process.env.JWT_SECRET);
  const { default: router } = await import('../src/modules/quizzes-engine/quizzes-engine.routes.js');
  const { createQuizQuestionInternal: create } = await import('../src/modules/quizzes-engine/quiz-questions/handlers/createQuizQuestion.js');
  const { updateQuizQuestionInternal: update } = await import('../src/modules/quizzes-engine/quiz-questions/handlers/updateQuizQuestion.js');
  const app = express();
  app.use(express.json());
  app.use('/api/quizzes', router);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  async function request(method, quizId, suffix = '', body, bearer = token) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/quizzes/${quizId}/questions${suffix}`, {
      method, headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, ...await response.json() };
  }
  async function quiz(userId = owner, status = 'draft') {
    const id = randomUUID();
    await client.query("INSERT INTO pg_temp.quizzes(id,user_id,title,question_count,status) VALUES ($1,$2,'Quiz',1,$3)", [id, userId, status]);
    return id;
  }
  async function question(userId = owner, type = 'single_choice') {
    const id = randomUUID();
    await client.query("INSERT INTO pg_temp.questions(id,user_id,type,content,explanation) VALUES ($1,$2,$3,'Question','Explanation')", [id, userId, type]);
    return id;
  }
  const insert = (quizId, questionId) => client.query('INSERT INTO pg_temp.quiz_questions(quiz_id,question_id) VALUES ($1,$2)', [quizId, questionId]);

  await t.test('all candidate routes require valid access tokens', async () => {
    const id = await quiz(), qid = await question();
    const temporary = jwt.sign({ sub: owner, purpose: 'two_factor' }, process.env.JWT_SECRET);
    for (const [method, suffix] of [['POST', ''], ['GET', ''], ['GET', `/${qid}`], ['PATCH', `/${qid}`], ['DELETE', `/${qid}`]]) {
      for (const bearer of [null, temporary]) assert.equal((await request(method, id, suffix, undefined, bearer)).status, 401);
    }
  });

  await t.test('CRUD preserves original questions, defaults and independent candidate membership', async () => {
    const id = await quiz(), secondQuiz = await quiz(owner, 'published'), qid = await question();
    const created = await request('POST', id.toUpperCase(), '', { question_id: qid.toUpperCase() });
    assert.equal(created.status, 201);
    assert.deepEqual(created.quiz_question, {
      quiz_id: id, question_id: qid, position: 0, max_points: 1,
      question: { id: qid, type: 'single_choice', content: 'Question', explanation: 'Explanation' },
    });
    assert.deepEqual((await request('GET', id, `/${qid}`)).quiz_question, created.quiz_question);
    assert.equal((await request('POST', id, '', { question_id: qid })).status, 409);
    assert.equal((await request('POST', secondQuiz, '', { question_id: qid, max_points: 0.29 })).status, 201);
    const patched = await request('PATCH', id, `/${qid}`, { max_points: 2.5 });
    assert.equal(patched.status, 200);
    assert.equal(patched.quiz_question.max_points, 2.5);
    assert.equal(patched.quiz_question.position, 0);
    const reordered = await request('PATCH', id, `/${qid}`, { position: 3 });
    assert.equal(reordered.quiz_question.max_points, 2.5);
    assert.equal(reordered.quiz_question.position, 3);
    assert.equal((await request('GET', secondQuiz, `/${qid}`)).quiz_question.max_points, 0.29);
    assert.deepEqual(await request('DELETE', id, `/${qid}`), { status: 200, success: true, deleted: true });
    assert.equal((await request('GET', id, `/${qid}`)).status, 404);
    assert.equal((await request('DELETE', id, `/${qid}`)).status, 404);
    assert.equal((await client.query('SELECT content FROM pg_temp.questions WHERE id=$1', [qid])).rows[0].content, 'Question');
    assert.equal((await request('GET', secondQuiz, `/${qid}`)).status, 200);
  });

  await t.test('ownership gates all reads and writes, including mixed-owner links', async () => {
    const id = await quiz(), qid = await question(), foreignQuiz = await quiz(other), foreignQuestion = await question(other);
    await insert(id, qid);
    await insert(foreignQuiz, foreignQuestion);
    for (const [method, suffix, body] of [
      ['GET', '', undefined], ['GET', `/${qid}`, undefined], ['POST', '', { question_id: qid }],
      ['PATCH', `/${qid}`, { position: 5 }], ['DELETE', `/${qid}`, undefined],
    ]) assert.equal((await request(method, id, suffix, body, otherToken)).status, 404);
    assert.equal((await request('POST', id, '', { question_id: foreignQuestion })).status, 404);
    assert.equal((await request('POST', foreignQuiz, '', { question_id: qid })).status, 404);
    for (const [method, suffix, body] of [['GET', '', undefined], ['POST', '', { question_id: qid }]]) {
      assert.equal((await request(method, randomUUID(), suffix, body)).status, 404);
    }
    assert.equal((await request('POST', id, '', { question_id: randomUUID() })).status, 404);
    assert.equal((await request('PATCH', id, `/${await question()}`, { position: 1 })).status, 404);
    assert.equal((await request('GET', id, `/${qid}`)).quiz_question.position, 0);
  });

  await t.test('candidate pool can exceed question_count and supports stable paginated sorting', async () => {
    const id = await quiz();
    const ids = [];
    for (const [index, type] of ['single_choice', 'multiple_choice', 'matching'].entries()) {
      const qid = await question(owner, type);
      ids.push(qid);
      assert.equal((await request('POST', id, '', { question_id: qid, position: index === 2 ? 1 : 0, max_points: index + 1 })).status, 201);
    }
    const expected = [...ids.slice(0, 2)].sort().concat(ids[2]);
    const groups = [{ id: randomUUID(), name: 'Group A' }, { id: randomUUID(), name: 'Group B' }].sort((a, b) => a.id.localeCompare(b.id));
    for (const group of groups) {
      await client.query('INSERT INTO pg_temp.question_groups(id,user_id,name) VALUES($1,$2,$3)', [group.id, owner, group.name]);
      await client.query('INSERT INTO pg_temp.question_group_items(group_id,question_id) VALUES($1,$2)', [group.id, expected[1]]);
    }
    const listing = await request('GET', id);
    assert.equal(listing.questions.length, 3);
    assert.deepEqual(listing.questions.map(row => row.question_id), expected);
    assert.deepEqual(listing.questions.map(row => row.question.groups), [[], groups, []]);
    assert.deepEqual(listing.sorting, { sortBy: 'position', sortOrder: 'asc' });
    const page = await request('GET', id, '?page=2&limit=1');
    assert.equal(page.questions[0].question_id, expected[1]);
    assert.deepEqual(page.questions[0].question.groups, groups);
    assert.deepEqual(page.pagination, { page: 2, limit: 1, total: 3, totalPages: 3, hasNextPage: true, hasPreviousPage: true });
    for (const sortBy of ['position', 'max_points', 'question_id']) {
      for (const sortOrder of ['asc', 'desc']) {
        const result = await request('GET', id, `?sortBy=${sortBy}&sortOrder=${sortOrder}`);
        const sorted = [...listing.questions].sort((a, b) => {
          const comparison = sortBy === 'question_id' ? a.question_id.localeCompare(b.question_id) : a[sortBy] - b[sortBy];
          return (sortOrder === 'asc' ? comparison : -comparison) || a.question_id.localeCompare(b.question_id);
        });
        assert.deepEqual(result.questions.map(row => row.question_id), sorted.map(row => row.question_id));
      }
    }
    const pastEnd = await request('GET', id, '?page=10&limit=1');
    assert.deepEqual(pastEnd.questions, []);
    assert.equal(pastEnd.pagination.total, 3);
    assert.equal(pastEnd.pagination.hasNextPage, false);
    const empty = await request('GET', await quiz());
    assert.deepEqual(empty.questions, []);
    assert.equal(empty.pagination.total, 0);
  });

  await t.test('moving a question shifts only the affected range, preserves weights and rolls back atomically', async () => {
    const id = await quiz(), otherQuiz = await quiz();
    const ids = [];
    for (let position = 0; position < 5; position++) {
      const qid = await question();
      ids.push(qid);
      await request('POST', id, '', { question_id: qid, position, max_points: position + 1 });
    }
    await request('POST', otherQuiz, '', { question_id: ids[4], position: 4, max_points: 9 });
    const list = async () => (await request('GET', id)).questions;
    let moved = await request('PATCH', id, `/${ids[4]}`, { position: 1, max_points: 7.5 });
    assert.equal(moved.status, 200);
    let rows = await list();
    assert.deepEqual(rows.map(row => row.question_id), [ids[0], ids[4], ids[1], ids[2], ids[3]]);
    assert.deepEqual(rows.map(row => row.position), [0, 1, 2, 3, 4]);
    assert.deepEqual(rows.map(row => row.max_points), [1, 7.5, 2, 3, 4]);
    moved = await request('PATCH', id, `/${ids[4]}`, { position: 4 });
    assert.equal(moved.quiz_question.max_points, 7.5);
    rows = await list();
    assert.deepEqual(rows.map(row => row.question_id), ids);
    assert.deepEqual(rows.map(row => row.position), [0, 1, 2, 3, 4]);
    await request('PATCH', id, `/${ids[4]}`, { position: 4 });
    assert.deepEqual(await list(), rows);
    await request('PATCH', id, `/${ids[4]}`, { max_points: 8 });
    assert.deepEqual((await list()).map(row => row.position), [0, 1, 2, 3, 4]);
    assert.equal((await request('GET', otherQuiz, `/${ids[4]}`)).quiz_question.position, 4);
    const before = await list();
    const unlinked = await question();
    assert.equal((await request('PATCH', id, `/${unlinked}`, { position: 0 })).status, 404);
    assert.deepEqual(await list(), before);
    failAfterMove = true;
    await assert.rejects(update({ quizId: id, questionId: ids[4] }, { position: 0, max_points: 99 }, owner), /Injected failure after move/);
    assert.deepEqual(await list(), before);
    await request('PATCH', id, `/${ids[4]}`, { position: 0 });
    assert.deepEqual((await list()).map(row => row.position), [0, 1, 2, 3, 4]);
  });

  await t.test('moves preserve sparse positions and safely shift duplicate positions and integer boundaries', async () => {
    const id = await quiz();
    const ids = [];
    for (const position of [0, 2, 2, 2147483647]) {
      const qid = await question(); ids.push(qid);
      await request('POST', id, '', { question_id: qid, position });
    }
    const positions = async () => {
      const rows = (await request('GET', id)).questions;
      return ids.map(qid => rows.find(row => row.question_id === qid).position);
    };
    assert.equal((await request('PATCH', id, `/${ids[3]}`, { position: 2 })).status, 200);
    assert.deepEqual(await positions(), [0, 3, 3, 2]);
    assert.equal((await request('PATCH', id, `/${ids[3]}`, { position: 2147483647 })).status, 200);
    assert.deepEqual(await positions(), [0, 2, 2, 2147483647]);
  });

  await t.test('invalid payloads, IDs and queries are rejected without changing the link', async () => {
    const id = await quiz(), qid = await question();
    await insert(id, qid);
    for (const body of [{}, { max_points: 0 }, { max_points: 1.001 }, { max_points: 100000000 }, { position: -1 }, { position: 0.5 }, { question_id: qid }, { quiz_id: id }, { user_id: other }]) {
      assert.equal((await request('PATCH', id, `/${qid}`, body)).status, 400);
    }
    assert.equal((await request('POST', id, '', { question_id: qid, max_points: null })).status, 400);
    assert.equal((await request('GET', 'invalid')).status, 400);
    assert.equal((await request('GET', id, '/invalid')).status, 400);
    for (const suffix of ['?limit=101', '?page=0', '?sortBy=content', '?sortOrder=ASC', `?user_id=${other}`]) {
      assert.equal((await request('GET', id, suffix)).status, 400);
    }
    assert.equal((await request('GET', id, `/${qid}`)).quiz_question.max_points, 1);
  });

  await t.test('database enforces keys, valid numbers, same-owner membership and parent ownership changes', async () => {
    const id = await quiz(), qid = await question(), foreignQuiz = await quiz(other), foreignQuestion = await question(other);
    await insert(id, qid);
    await assert.rejects(insert(id, qid), { code: '23505' });
    await assert.rejects(insert(id, foreignQuestion), { code: '23514', constraint: 'quiz_questions_same_user_check' });
    await assert.rejects(insert(foreignQuiz, qid), { code: '23514' });
    await assert.rejects(insert(id, randomUUID()), { code: '23503' });
    await assert.rejects(insert(randomUUID(), qid), { code: '23503' });
    await assert.rejects(insert(id, null), { code: '23502' });
    for (const value of [0, -1, 'NaN']) await assert.rejects(client.query('UPDATE pg_temp.quiz_questions SET max_points=$1 WHERE quiz_id=$2', [value, id]), { code: '23514' });
    await assert.rejects(client.query('UPDATE pg_temp.quiz_questions SET position=-1 WHERE quiz_id=$1', [id]), { code: '23514' });
    await assert.rejects(client.query('UPDATE pg_temp.quiz_questions SET max_points=NULL WHERE quiz_id=$1', [id]), { code: '23502' });
    await assert.rejects(client.query('UPDATE pg_temp.quiz_questions SET question_id=$1 WHERE quiz_id=$2', [foreignQuestion, id]), { code: '23514' });
    await assert.rejects(client.query('UPDATE pg_temp.quiz_questions SET quiz_id=$1 WHERE question_id=$2', [foreignQuiz, qid]), { code: '23514' });
    await assert.rejects(client.query('UPDATE pg_temp.quizzes SET user_id=$1 WHERE id=$2', [other, id]), { code: '23514' });
    await assert.rejects(client.query('UPDATE pg_temp.questions SET user_id=$1 WHERE id=$2', [other, qid]), { code: '23514' });
    await client.query('UPDATE pg_temp.questions SET user_id=user_id WHERE id=$1', [qid]);
    const index = await client.query("SELECT indexdef FROM pg_indexes WHERE schemaname LIKE 'pg_temp_%' AND indexname='quiz_questions_question_id_idx'");
    assert.match(index.rows[0].indexdef, /\(question_id\)/);
  });

  await t.test('failed writes roll back and release their connection', async () => {
    const id = await quiz(), qid = await question(), before = releases;
    failAfterInsert = true;
    await assert.rejects(create({ quizId: id }, { question_id: qid }, owner), /Injected failure/);
    assert.equal(releases, before + 1);
    assert.equal((await request('GET', id)).pagination.total, 0);
    assert.equal((await request('POST', id, '', { question_id: qid })).status, 201);
  });

  await t.test('deleting either parent cascades only its links and preserves the other parent', async () => {
    const id = await quiz(), secondQuiz = await quiz(), qid = await question(), secondQuestion = await question();
    await insert(id, qid);
    await insert(id, secondQuestion);
    await insert(secondQuiz, qid);
    await client.query('DELETE FROM pg_temp.quizzes WHERE id=$1', [id]);
    assert.equal((await client.query('SELECT * FROM pg_temp.quiz_questions WHERE quiz_id=$1', [id])).rowCount, 0);
    assert.equal((await client.query('SELECT * FROM pg_temp.questions WHERE id=ANY($1::uuid[])', [[qid, secondQuestion]])).rowCount, 2);
    assert.equal((await request('GET', secondQuiz)).pagination.total, 1);
    await client.query('DELETE FROM pg_temp.questions WHERE id=$1', [qid]);
    assert.equal((await request('GET', secondQuiz)).pagination.total, 0);
  });

  await t.test('rollback removes its triggers and functions, preserves parents and allows reapplying', async () => {
    const id = await quiz(), qid = await question();
    await insert(id, qid);
    await client.query(migration.split('-- Down Migration')[1]);
    assert.equal((await client.query("SELECT to_regclass('pg_temp.quiz_questions') AS name")).rows[0].name, null);
    assert.equal((await client.query("SELECT to_regprocedure('pg_temp.validate_quiz_question_owner()') AS name")).rows[0].name, null);
    await client.query('UPDATE pg_temp.quizzes SET user_id=$1 WHERE id=$2', [other, id]);
    await client.query('UPDATE pg_temp.questions SET user_id=$1 WHERE id=$2', [other, qid]);
    await client.query(migration.split('-- Down Migration')[0]);
    await insert(id, qid);
    assert.equal((await request('GET', id, `/${qid}`, undefined, otherToken)).status, 200);
  });
});
