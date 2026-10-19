import { installQuizPermissions } from './helpers/quiz-permissions-schema.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { mock, test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';

test('start/resume attempts, snapshots, source quotas and concurrency against isolated PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const schema = `quiz_start_test_${randomUUID().replaceAll('-', '')}`;
  const connectionString = process.env.TEST_DATABASE_URL;
  const admin = new pg.Client({ connectionString, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  await admin.connect();
  const pool = new pg.Pool({ connectionString, max: 6, connectionTimeoutMillis: 5000, statement_timeout: 10000, options: `-c search_path=${schema},public` });
  t.after(async () => {
    await pool.end();
    try { await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); } finally { await admin.end(); }
  });
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.query(`SET search_path TO ${schema},public`);
  await admin.query("CREATE TABLE users (id uuid PRIMARY KEY, status text DEFAULT 'active', authz_version integer DEFAULT 1)");
  await admin.query('CREATE TABLE videos (id uuid PRIMARY KEY, duration_seconds integer)');
  await admin.query('CREATE TABLE watch_progress (user_id uuid, video_id uuid, total_watch_seconds numeric, PRIMARY KEY(user_id, video_id))');
  for (const file of ['1791590400001_add-questions.sql', '1791590400003_add-question-groups.sql', '1791590400004_add-quizzes.sql',
    '1791763200000_add-quiz-requirements.sql', '1792195200000_add-quiz-feedback-and-scoring-settings.sql',
    '1792195200001_add-quiz-attempts.sql', '1792195200002_add-quiz-attempt-questions-and-answers.sql',
    '1792281600000_add-quiz-questions.sql', '1792281600001_add-quiz-sources.sql']) {
    const sql = (await readFile(new URL(`../src/database/migrations/${file}`, import.meta.url), 'utf8')).replaceAll('public.', `${schema}.`);
    await admin.query(sql.split('-- Down Migration')[0]);
  }
  const owner = randomUUID(), participant = randomUUID(), other = randomUUID();
  await admin.query('INSERT INTO users(id) VALUES ($1),($2),($3)', [owner, participant, other]);
  await installQuizPermissions(admin, { schema });
  let failQuestions = false, released = 0;
  const queryOn = database => async (sql, params) => {
    const result = await database.query(sql.replaceAll('public.', `${schema}.`), params);
    if (failQuestions && /INSERT INTO public.quiz_attempt_questions/.test(sql)) {
      failQuestions = false;
      throw new Error('Injected snapshot failure');
    }
    return result;
  };
  mock.module(new URL('../src/database/index.js', import.meta.url).href, { namedExports: { writePool: {
    query: queryOn(pool), async connect() { const client = await pool.connect(); return { query: queryOn(client), release() { released++; client.release(); } }; },
  } } });
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'quiz-attempt-start-test-secret';
  t.after(() => { if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret; });
  const tokenFor = (sub, fields = {}) => jwt.sign({ sub, authzVersion: 1, ...fields }, process.env.JWT_SECRET);
  const token = tokenFor(participant);
  const { default: router } = await import('../src/modules/quizzes-engine/quizzes-engine.routes.js');
  const { startQuizAttemptInternal: start } = await import('../src/modules/quizzes-engine/quiz-attempts/handlers/startQuizAttempt.js');
  const app = express();
  app.use(express.json());
  app.use('/api/quizzes', router);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  async function request(id, bearer = token, body) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/quizzes/${id}/attempts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, cache: response.headers.get('cache-control'), body: await response.json() };
  }
  async function quiz({ count = 2, limit = null, time = 120, status = 'published' } = {}) {
    const id = randomUUID();
    await admin.query(`INSERT INTO quizzes(id,user_id,title,status,question_count,max_attempts,time_limit_seconds,shuffle_questions,shuffle_options)
      VALUES ($1,$2,'Quiz',$3,$4,$5,$6,false,false)`, [id, owner, status, count, limit, time]);
    return id;
  }
  async function question(id, { position = 0, points = 1, type = 'single_choice', valid = true, linked = true } = {}) {
    const qid = randomUUID();
    await admin.query("INSERT INTO questions(id,user_id,type,content,explanation) VALUES ($1,$2,$3,'Original content','SECRET explanation')", [qid, owner, type]);
    if (valid && type === 'matching') {
      await admin.query("INSERT INTO question_matching_options VALUES ($1,1,'A',1),($1,2,'B',2)", [qid]);
      await admin.query("INSERT INTO question_matching_items VALUES ($1,1,'X',2,1),($1,2,'Y',1,2)", [qid]);
    } else if (valid) {
      await admin.query("INSERT INTO question_options VALUES ($1,1,'A',true,1),($1,2,'B',false,2)", [qid]);
    }
    if (linked) await admin.query('INSERT INTO quiz_questions(quiz_id,question_id,position,max_points) VALUES ($1,$2,$3,$4)', [id, qid, position, points]);
    return qid;
  }
  async function group(questionIds) {
    const gid = randomUUID();
    await admin.query('INSERT INTO question_groups(id,user_id,name) VALUES ($1,$2,$3)', [gid, owner, gid]);
    for (const qid of questionIds) await admin.query('INSERT INTO question_group_items VALUES ($1,$2)', [gid, qid]);
    return gid;
  }
  async function sources(id, entries) {
    await admin.query(`INSERT INTO quiz_sources(quiz_id,group_id,position,question_percentage,question_count)
      SELECT $1, group_id, position, question_percentage, question_count FROM jsonb_to_recordset($2::jsonb)
        AS x(group_id uuid,position integer,question_percentage numeric,question_count integer)`, [id, JSON.stringify(entries)]);
  }
  const totalAttempts = async id => Number((await admin.query('SELECT count(*) FROM quiz_attempts WHERE quiz_id=$1', [id])).rows[0].count);
  const savedQuestions = async id => (await admin.query('SELECT * FROM quiz_attempt_questions WHERE attempt_id=$1 ORDER BY question_no', [id])).rows;
  async function historical(id, status, attemptNo, userId = participant) {
    await admin.query("INSERT INTO quiz_attempts(quiz_id,user_id,status,attempt_no,settings_snapshot) VALUES ($1,$2,$3,$4,'{}')", [id, userId, status, attemptNo]);
  }

  await t.test('auth, visibility and unpublished quiz availability return the specified errors', async () => {
    const id = await quiz();
    for (const bearer of [null, tokenFor(participant, { purpose: 'two_factor' }), tokenFor(participant, { authzVersion: 0 })]) {
      assert.equal((await request(id, bearer)).status, 401);
    }
    assert.equal((await request('bad')).status, 400);
    assert.equal((await request(randomUUID())).status, 404);
    for (const status of ['draft', 'archived']) {
      const hidden = await quiz({ status });
      assert.equal((await request(hidden)).status, 404);
      const own = await request(hidden, tokenFor(owner));
      assert.equal(own.status, 409);
      assert.equal(own.body.code, 'QUIZ_UNAVAILABLE');
    }
  });

  await t.test('creation persists complete snapshots, point weights and times, returning no answer keys', async () => {
    const id = await quiz();
    const a = await question(id, { position: 2, points: 2.25 });
    const b = await question(id, { position: 1, points: 3.5, type: 'matching' });
    const response = await request(id.toUpperCase(), token, { user_id: other, attempt_no: 99 });
    assert.equal(response.status, 201);
    assert.equal(response.cache, 'private, no-store');
    assert.equal(response.body.attempt_no, 1);
    assert.equal(response.body.status, 'in_progress');
    assert.deepEqual(response.body.questions.map(q => q.question_id), [b, a]);
    assert.deepEqual(response.body.questions.map(q => q.question_no), [1, 2]);
    assert.deepEqual(response.body.questions.map(q => q.max_points), [3.5, 2.25]);
    assert.equal(new Date(response.body.expires_at) - new Date(response.body.started_at), 120000);
    assert.equal(response.body.settings.scoring_mode, 'exact_match');
    assert.doesNotMatch(JSON.stringify(response.body.questions), /is_correct|correct_option_no|explanation|SECRET|source_group_id/);
    const attempt = (await admin.query('SELECT * FROM quiz_attempts WHERE id=$1', [response.body.id])).rows[0];
    assert.equal(attempt.user_id, participant);
    assert.equal(attempt.max_points, '5.75');
    assert.equal(attempt.earned_points, null);
    assert.deepEqual(attempt.settings_snapshot, response.body.settings);
    const saved = await savedQuestions(attempt.id);
    assert.equal(saved[0].question_snapshot.matching_items[0].correct_option_no, 2);
    assert.equal(saved[1].question_snapshot.options[0].is_correct, true);
    assert.equal(saved[1].question_snapshot.explanation, 'SECRET explanation');
  });

  await t.test('resume keeps original settings, order and content despite live edits and new unmet requirements', async () => {
    const id = await quiz({ count: 1, limit: 1, time: null });
    const qid = await question(id);
    const initial = await request(id);
    assert.equal(initial.body.expires_at, null);
    await admin.query("UPDATE quizzes SET passing_score_percentage=99,shuffle_options=true,question_count=5 WHERE id=$1", [id]);
    await admin.query("UPDATE questions SET content='Edited content',explanation='NEW SECRET' WHERE id=$1", [qid]);
    await admin.query('DELETE FROM questions WHERE id=$1', [qid]);
    const video = randomUUID();
    await admin.query('INSERT INTO videos VALUES ($1,200)', [video]);
    await admin.query('INSERT INTO quiz_requirements(quiz_id,video_id,min_watch_seconds) VALUES ($1,$2,100)', [id, video]);
    const resumed = await request(id);
    assert.equal(resumed.status, 200);
    assert.equal(resumed.body.id, initial.body.id);
    assert.deepEqual(resumed.body.settings, initial.body.settings);
    assert.equal(resumed.body.questions[0].content, 'Original content');
    assert.equal(resumed.body.questions[0].question_id, null);
    assert.equal(resumed.body.questions[0].options[0].content, 'A');
    assert.equal(await totalAttempts(id), 1);
  });

  await t.test('watch requirements are rechecked from authenticated progress before limits or configuration', async () => {
    const id = await quiz({ count: 1 });
    await question(id);
    const a = randomUUID(), b = randomUUID();
    await admin.query('INSERT INTO videos VALUES ($1,200),($2,120)', [a, b]);
    await admin.query(`INSERT INTO quiz_requirements(quiz_id,video_id,min_watch_percentage,min_watch_seconds)
      VALUES ($1,$2,75.25,NULL),($1,$3,NULL,60)`, [id, a, b]);
    await admin.query('INSERT INTO watch_progress VALUES ($1,$2,500),($1,$3,500)', [other, a, b]);
    const blocked = await request(id, token, { user_id: other });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.code, 'REQUIREMENTS_NOT_MET');
    await admin.query('INSERT INTO watch_progress VALUES ($1,$2,150.49),($1,$3,60)', [participant, a, b]);
    assert.equal((await request(id)).status, 403);
    await admin.query('UPDATE watch_progress SET total_watch_seconds=150.5 WHERE user_id=$1 AND video_id=$2', [participant, a]);
    assert.equal((await request(id)).status, 201);
  });

  await t.test('all previous statuses count; unlimited retries use max attempt_no plus one', async () => {
    const id = await quiz({ count: 1, limit: 3 });
    await question(id);
    await historical(id, 'submitted', 2);
    await historical(id, 'timed_out', 7);
    await historical(id, 'cancelled', 9);
    const blocked = await request(id);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.code, 'MAX_ATTEMPTS_REACHED');
    await admin.query('UPDATE quizzes SET max_attempts=NULL WHERE id=$1', [id]);
    await historical(id, 'submitted', 99, other);
    assert.equal((await request(id)).body.attempt_no, 10);
  });

  await t.test('expired attempts remain unchanged pending future finalization and block new writes', async () => {
    const id = await quiz({ count: 1 });
    await question(id);
    const created = await request(id);
    await admin.query("UPDATE quiz_attempts SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [created.body.id]);
    const response = await request(id);
    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'ATTEMPT_FINALIZATION_PENDING');
    assert.equal(await totalAttempts(id), 1);
    assert.equal((await admin.query('SELECT status FROM quiz_attempts WHERE id=$1', [created.body.id])).rows[0].status, 'in_progress');
  });

  await t.test('insufficient candidates, invalid drafts and impossible overlapping quotas return 422 without writes', async () => {
    const empty = await quiz();
    assert.equal((await request(empty)).status, 422);
    const incomplete = await quiz({ count: 1 });
    await question(incomplete, { valid: false });
    assert.equal((await request(incomplete)).body.code, 'INVALID_QUIZ_CONFIGURATION');
    const overlap = await quiz();
    const shared = await question(overlap);
    await question(overlap); // In the pool but in neither source.
    const notCandidate = await question(overlap, { linked: false });
    const g1 = await group([shared, notCandidate]), g2 = await group([shared]);
    await sources(overlap, [{ group_id: g1, position: 0, question_count: 1 }, { group_id: g2, position: 1, question_count: 1 }]);
    const response = await request(overlap);
    assert.equal(response.status, 422);
    assert.equal(response.body.code, 'INSUFFICIENT_QUESTIONS');
    for (const id of [empty, incomplete, overlap]) assert.equal(await totalAttempts(id), 0);
  });

  await t.test('exact source quotas assign shared questions once and exclude questions outside quiz_questions', async () => {
    const id = await quiz({ count: 3 });
    const shared = await question(id), wideOnly = await question(id), third = await question(id);
    const outside = await question(id, { linked: false });
    const wide = await group([shared, wideOnly, outside]), narrow = await group([shared]), last = await group([third]);
    await sources(id, [{ group_id: wide, position: 0, question_count: 1 }, { group_id: narrow, position: 1, question_count: 1 }, { group_id: last, position: 2, question_count: 1 }]);
    const response = await request(id);
    assert.equal(response.status, 201);
    const rows = await savedQuestions(response.body.id);
    assert.equal(new Set(rows.map(q => q.question_id)).size, 3);
    assert.equal(rows.find(q => q.question_id === shared).question_snapshot.source_group_id, narrow);
    assert.equal(rows.find(q => q.question_id === wideOnly).question_snapshot.source_group_id, wide);
    assert.ok(!rows.some(q => q.question_id === outside));
  });

  await t.test('percentage sources allocate exactly question_count and preserve shuffled presentation on resume', async () => {
    const id = await quiz({ count: 3 });
    const left = await group([await question(id), await question(id)]);
    const right = await group([await question(id), await question(id)]);
    await sources(id, [{ group_id: left, position: 0, question_percentage: 50 }, { group_id: right, position: 1, question_percentage: 50 }]);
    await admin.query('UPDATE quizzes SET shuffle_questions=true,shuffle_options=true WHERE id=$1', [id]);
    const initial = await request(id);
    assert.equal(initial.status, 201);
    const rows = await savedQuestions(initial.body.id);
    assert.equal(rows.filter(q => q.question_snapshot.source_group_id === left).length, 2);
    assert.equal(rows.filter(q => q.question_snapshot.source_group_id === right).length, 1);
    assert.deepEqual((await request(id)).body, initial.body);
  });

  await t.test('concurrent requests create exactly one attempt and return it to every caller', async () => {
    const id = await quiz({ count: 1, limit: 1 });
    await question(id);
    const results = await Promise.all(Array.from({ length: 4 }, () => request(id)));
    assert.deepEqual(results.map(r => r.status).sort(), [200, 200, 200, 201]);
    assert.equal(new Set(results.map(r => r.body.id)).size, 1);
    assert.ok(results.every(r => JSON.stringify(r.body.questions) === JSON.stringify(results[0].body.questions)));
    assert.equal(await totalAttempts(id), 1);
    await admin.query("UPDATE quiz_attempts SET status='submitted' WHERE quiz_id=$1", [id]);
    assert.deepEqual((await Promise.all([request(id), request(id)])).map(r => r.status), [409, 409]);
    assert.equal(await totalAttempts(id), 1);
    assert.equal((await request(id, tokenFor(other))).status, 201);
  });

  await t.test('snapshot failure rolls back both tables, releases the client and does not consume an attempt', async () => {
    const id = await quiz({ count: 1, limit: 1 });
    await question(id);
    const before = released;
    failQuestions = true;
    await assert.rejects(start(id, participant), /Injected snapshot failure/);
    assert.equal(released, before + 1);
    assert.equal(await totalAttempts(id), 0);
    assert.equal((await admin.query('SELECT count(*) FROM quiz_attempt_questions aq JOIN quiz_attempts a ON a.id=aq.attempt_id WHERE a.quiz_id=$1', [id])).rows[0].count, '0');
    const retried = await request(id);
    assert.equal(retried.status, 201);
    assert.equal(retried.body.attempt_no, 1);
  });
});
