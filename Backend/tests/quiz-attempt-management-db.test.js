import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { mock, test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { installQuizPermissions } from './helpers/quiz-permissions-schema.js';
import { upgradeCertificateIssuance } from './helpers/quiz-certificate-schema.js';
import { answerSettings, answerSnapshot } from './helpers/quiz-answer-fixtures.js';

test('quiz attempt management: author permissions, reports and deletion', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const schema = `quiz_management_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL, statement_timeout: 10000 });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}; SET search_path TO ${schema},public`);
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 6,
    statement_timeout: 10000, options: `-c search_path=${schema},public` });
  t.after(async () => {
    await pool.end();
    try { await admin.query(`DROP SCHEMA ${schema} CASCADE`); } finally { await admin.end(); }
  });
  await admin.query(`CREATE TABLE users(id uuid PRIMARY KEY,status text DEFAULT 'active',authz_version integer DEFAULT 1,
    full_name text, image_url text, email text, password_hash text)`);
  async function migrate(file, down = false) {
    const sql = (await readFile(new URL(`../src/database/migrations/${file}`, import.meta.url), 'utf8'))
      .replaceAll('public.', `${schema}.`).split('-- Down Migration');
    await admin.query(sql[down ? 1 : 0]);
  }
  for (const file of ['1791590400001_add-questions.sql', '1791590400004_add-quizzes.sql',
    '1792195200000_add-quiz-feedback-and-scoring-settings.sql', '1792627200001_add-quiz-questions-per-page.sql',
    '1792195200001_add-quiz-attempts.sql', '1792195200002_add-quiz-attempt-questions-and-answers.sql']) await migrate(file);
  await upgradeCertificateIssuance(admin, { schema });
  await migrate('1793059200000_certificate-attempt-on-delete-set-null.sql');
  await installQuizPermissions(admin, { schema, defaultRole: null });
  const author = randomUUID(), foreignAuthor = randomUUID(), participant = randomUUID(), administrator = randomUUID(), owner = randomUUID();
  for (const [id, role] of [[author, 'Uploader'], [foreignAuthor, 'Uploader'], [participant, 'Viewer'], [administrator, 'Administrator'], [owner, 'Owner']]) {
    await admin.query("INSERT INTO users(id,full_name,image_url,email,password_hash) VALUES ($1,$2,'avatar','private@example.test','SECRET')", [id, role]);
    await admin.query('INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE name=$2', [id, role]);
  }
  let onAdvisoryLock;
  const queryOn = database => async (sql, params) => {
    if (sql.includes('pg_advisory_xact_lock')) onAdvisoryLock?.();
    return database.query(sql.replaceAll('public.', `${schema}.`), params);
  };
  mock.module(new URL('../src/database/index.js', import.meta.url).href, { namedExports: { writePool: {
    query: queryOn(pool), async connect() { const client = await pool.connect(); return { query: queryOn(client), release: () => client.release() }; },
  } } });
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'quiz-management-test';
  t.after(() => { if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret; });
  const { default: routes, quizAttemptAnswerRoutes } = await import('../src/modules/quizzes-engine/quiz-attempts/quiz-attempts.routes.js');
  const app = express(); app.use(express.json()); app.use('/api/quizzes', routes); app.use('/api/quiz-attempts', quizAttemptAnswerRoutes);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  async function request(actor, method, path) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method,
      headers: actor ? { Authorization: `Bearer ${jwt.sign({ sub: actor, authzVersion: 1 }, process.env.JWT_SECRET)}` } : {} });
    return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
  }
  async function quiz(user = author, status = 'published') {
    const id = randomUUID();
    await admin.query('INSERT INTO quizzes(id,user_id,title,question_count,status,max_attempts) VALUES ($1,$2,$3,3,$4,1)', [id, user, 'Quiz', status]);
    return id;
  }
  async function attempt(quizId, user = participant, status = 'submitted', no = 1, passed = true) {
    const id = randomUUID();
    const settings = { ...answerSettings, show_final_score: false, allow_attempt_review: false,
      correctness_visibility: 'never', correct_answers_visibility: 'never', explanation_visibility: 'never' };
    await admin.query(`INSERT INTO quiz_attempts(id,quiz_id,user_id,attempt_no,status,started_at,finished_at,
      earned_points,max_points,score_percentage,passed,settings_snapshot)
      VALUES ($1,$2,$3,$4,$5::quiz_attempt_status,'2026-01-01',CASE WHEN $5::quiz_attempt_status='in_progress' THEN NULL ELSE now() END,
        CASE WHEN $5='in_progress' THEN NULL ELSE 2 END,3,
        CASE WHEN $5='in_progress' THEN NULL ELSE 66.67 END,$6,$7)`,
    [id, quizId, user, no, status, status === 'in_progress' ? null : passed, settings]);
    return id;
  }
  const quizId = await quiz();
  const attemptId = await attempt(quizId);
  const otherId = await attempt(quizId, foreignAuthor, 'submitted', 1, false);
  const activeId = await attempt(quizId, participant, 'in_progress', 2);
  const foreignQuiz = await quiz(foreignAuthor), foreignAttempt = await attempt(foreignQuiz);

  await t.test('authentication, quiz ownership and attempt/quiz binding protect all three routes', async () => {
    for (const [method, path] of [['GET', `/${quizId}/results`], ['GET', `/${quizId}/results/${attemptId}`], ['DELETE', `/${quizId}/attempts/${attemptId}`]]) {
      assert.equal((await request(null, method, `/quizzes${path}`)).status, 401);
      assert.equal((await request(participant, method, `/quizzes${path}`)).status, 403);
      assert.equal((await request(foreignAuthor, method, `/quizzes${path}`)).status, 404);
    }
    for (const actor of [author, administrator, owner]) {
      assert.equal((await request(actor, 'GET', `/quizzes/${quizId}/results`)).status, 200);
      assert.equal((await request(actor, 'GET', `/quizzes/${quizId}/results/${attemptId}`)).status, 200);
      assert.equal((await request(actor, 'GET', `/quizzes/${quizId}/results/${foreignAttempt}`)).status, 404);
      assert.equal((await request(actor, 'DELETE', `/quizzes/${quizId}/attempts/${foreignAttempt}`)).status, 404);
    }
    const viewerQuiz = await quiz(participant);
    assert.equal((await request(participant, 'GET', `/quizzes/${viewerQuiz}/results`)).status, 403);
  });
  await t.test('list filters, stable pagination and numeric scores; participant list remains private', async () => {
    const result = await request(author, 'GET', `/quizzes/${quizId}/results?limit=1`);
    assert.equal(result.cache, 'private, no-store');
    assert.equal(result.body.pagination.total, 3);
    assert.equal(result.body.pagination.totalPages, 3);
    assert.equal(result.body.pagination.hasNextPage, true);
    const ids = [];
    for (let page = 1; page <= 3; page++) ids.push((await request(author, 'GET', `/quizzes/${quizId}/results?limit=1&page=${page}`)).body.attempts[0].id);
    assert.deepEqual(ids, [attemptId, otherId, activeId].sort());
    const filtered = (await request(author, 'GET', `/quizzes/${quizId}/results?user_id=${participant.toUpperCase()}&status=submitted&passed=true&sortBy=score_percentage&sortOrder=asc`)).body;
    assert.equal(filtered.pagination.total, 1);
    assert.equal(filtered.attempts[0].id, attemptId);
    assert.equal(filtered.attempts[0].score_percentage, 66.67);
    assert.deepEqual(filtered.attempts[0].user, { id: participant, full_name: 'Viewer', image_url: 'avatar' });
    assert.equal((await request(author, 'GET', `/quizzes/${quizId}/results?passed=false`)).body.attempts[0].id, otherId);
    assert.equal((await request(author, 'GET', `/quizzes/${quizId}/results?status=in_progress`)).body.attempts[0].earned_points, null);
    const beyond = (await request(author, 'GET', `/quizzes/${quizId}/results?page=99`)).body;
    assert.deepEqual(beyond.attempts, []); assert.equal(beyond.pagination.total, 3);
    assert.equal((await request(author, 'GET', `/quizzes/${quizId}/results?user_id=${randomUUID()}`)).body.pagination.total, 0);
    const mine = (await request(participant, 'GET', `/quizzes/${quizId}/attempts`)).body;
    assert.equal(mine.pagination.total, 2);
    assert.ok(mine.attempts.every(a => a.id !== otherId && a.score_percentage === null && !a.user));
  });
  await t.test('validation rejects invalid filters, IDs, sorting and pagination', async () => {
    for (const query of ['passed=0', 'passed=', 'user_id=bad', 'user_id=x&user_id=y', 'status=bad', 'sortBy=password_hash', 'sortOrder=bad', 'limit=101', 'page=0', 'page=9007199254740991&limit=100', 'unknown=x']) {
      assert.equal((await request(author, 'GET', `/quizzes/${quizId}/results?${query}`)).status, 400, query);
    }
    assert.equal((await request(author, 'GET', '/quizzes/bad/results')).status, 400);
    assert.equal((await request(author, 'GET', `/quizzes/${randomUUID()}/results`)).status, 404);
    for (const [method, suffix] of [['GET', 'results'], ['DELETE', 'attempts']]) {
      assert.equal((await request(author, method, `/quizzes/${quizId}/${suffix}/bad`)).status, 400);
      assert.equal((await request(author, method, `/quizzes/${quizId}/${suffix}/${randomUUID()}`)).status, 404);
    }
  });
  await t.test('detail returns immutable snapshots and unchecked drafts without grading or participant restrictions', async () => {
    const originalQuestion = randomUUID();
    await admin.query("INSERT INTO questions(id,user_id,type,content) VALUES ($1,$2,'single_choice','CURRENT content')", [originalQuestion, author]);
    for (const [no, type] of [[3, 'matching'], [2, 'multiple_choice'], [1, 'single_choice']]) {
      await admin.query('INSERT INTO quiz_attempt_questions VALUES ($1,$2,$3,$4,1)', [attemptId, no, no === 1 ? originalQuestion : null, answerSnapshot(type)]);
    }
    await admin.query(`INSERT INTO quiz_attempt_answers(attempt_id,question_no,answer,checked_at,is_correct,awarded_points)
      VALUES ($1,1,'{"option_no":1}',now(),true,1),($1,2,'{"option_nos":[2]}',NULL,NULL,NULL)`, [attemptId]);
    const before = (await admin.query('SELECT * FROM quiz_attempt_answers WHERE attempt_id=$1 ORDER BY question_no', [attemptId])).rows;
    const result = await request(author, 'GET', `/quizzes/${quizId}/results/${attemptId}`);
    assert.equal(result.cache, 'private, no-store');
    assert.equal(result.body.attempt.earned_points, 2);
    assert.equal(result.body.attempt.settings.show_final_score, false);
    assert.deepEqual(result.body.attempt.questions.map(q => q.question_no), [1, 2, 3]);
    const [single, multiple, matching] = result.body.attempt.questions;
    assert.deepEqual(single.question_snapshot, answerSnapshot());
    assert.equal(single.awarded_points, 1); assert.equal(single.is_correct, true);
    assert.equal(single.can_edit, false);
    assert.deepEqual(multiple.answer, { option_nos: [2] }); assert.equal(multiple.checked_at, null);
    assert.equal(multiple.awarded_points, null); assert.equal(matching.answer, null);
    assert.equal(matching.question_snapshot.matching_items[0].correct_option_no, 1);
    assert.deepEqual((await admin.query('SELECT * FROM quiz_attempt_answers WHERE attempt_id=$1 ORDER BY question_no', [attemptId])).rows, before);
    assert.equal((await request(participant, 'GET', `/quiz-attempts/${attemptId}/questions`)).status, 403);
    for (const state of ['draft', 'archived']) {
      await admin.query('UPDATE quizzes SET status=$2 WHERE id=$1', [quizId, state]);
      assert.equal((await request(author, 'GET', `/quizzes/${quizId}/results`)).status, 200);
      assert.equal((await request(author, 'GET', `/quizzes/${quizId}/results/${attemptId}`)).status, 200);
    }
  });
  await t.test('delete cascades in every attempt status, preserves questions and issued certificates, frees attempt quota', async () => {
    for (const [state, actor] of [['in_progress', author], ['submitted', administrator], ['timed_out', owner], ['cancelled', author]]) {
      const q = await quiz(), a = await attempt(q, participant, state), original = randomUUID();
      if (state === 'in_progress') await admin.query("UPDATE quiz_attempts SET expires_at=now()-interval '1 second' WHERE id=$1", [a]);
      const detail = await request(actor, 'GET', `/quizzes/${q}/results/${a}`);
      assert.equal(detail.status, 200);
      assert.equal(detail.body.attempt.status, state);
      assert.equal(detail.body.attempt.is_expired, state === 'in_progress');
      await admin.query("INSERT INTO questions(id,user_id,type,content) VALUES ($1,$2,'single_choice','Original')", [original, author]);
      await admin.query('INSERT INTO quiz_attempt_questions VALUES ($1,1,$2,$3,1)', [a, original, answerSnapshot()]);
      await admin.query(`INSERT INTO quiz_attempt_answers(attempt_id,question_no,answer) VALUES ($1,1,'{"option_no":1}')`, [a]);
      let cert;
      if (state === 'submitted') {
        cert = (await admin.query(`INSERT INTO certificates(user_id,quiz_id,quiz_attempt_id,certificate_template_id,data_snapshot,template_snapshot)
          SELECT $1,$2,$3,id,'{"keep":true}','{}' FROM certificate_templates LIMIT 1 RETURNING id`, [participant, q, a])).rows[0].id;
      }
      const deleted = await request(actor, 'DELETE', `/quizzes/${q}/attempts/${a}`);
      assert.equal(deleted.status, 200); assert.equal(deleted.body.deleted, true);
      for (const [table, field] of [['quiz_attempts', 'id'], ['quiz_attempt_questions', 'attempt_id'], ['quiz_attempt_answers', 'attempt_id']]) {
        assert.equal((await admin.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${field}=$1`, [a])).rows[0].n, 0);
      }
      assert.equal((await admin.query('SELECT id FROM questions WHERE id=$1', [original])).rowCount, 1);
      if (cert) assert.deepEqual((await admin.query('SELECT quiz_attempt_id,data_snapshot FROM certificates WHERE id=$1', [cert])).rows[0], { quiz_attempt_id: null, data_snapshot: { keep: true } });
      const participantList = await request(participant, 'GET', `/quizzes/${q}/attempts`);
      assert.equal(participantList.body.pagination.total, 0);
      const { getAttemptHistory } = await import('../src/modules/quizzes-engine/quiz-attempts/repository/quiz-attempts.repository.js');
      assert.deepEqual(await getAttemptHistory({ query: queryOn(pool) }, q, participant), { attempts_used: 0, last_attempt_no: 0 });
      assert.equal((await request(actor, 'DELETE', `/quizzes/${q}/attempts/${a}`)).status, 404);
    }
  });
  await t.test('delete serializes against the same history lock used by starting attempts', async () => {
    const q = await quiz(), a = await attempt(q);
    const blocker = await pool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended('quiz-attempt:' || $1::text || ':' || $2::text,0))", [q, participant]);
      const arrived = new Promise(resolve => { onAdvisoryLock = resolve; });
      const deleting = request(author, 'DELETE', `/quizzes/${q}/attempts/${a}`);
      await arrived; onAdvisoryLock = undefined;
      assert.equal((await blocker.query('SELECT id FROM quiz_attempts WHERE id=$1', [a])).rowCount, 1);
      await blocker.query('COMMIT');
      assert.equal((await deleting).status, 200);
    } finally { onAdvisoryLock = undefined; await blocker.query('ROLLBACK'); blocker.release(); }
  });
  await t.test('read does not imply delete; explicit denies apply and Owner bypasses them', async () => {
    const q = await quiz(), a = await attempt(q);
    await admin.query(`UPDATE role_permissions SET effect='deny' WHERE role_id=(SELECT id FROM roles WHERE name='Uploader')
      AND permission_id=(SELECT id FROM permissions WHERE key='quizzes.attempts.delete_own')`);
    assert.equal((await request(author, 'GET', `/quizzes/${q}/results`)).status, 200);
    assert.equal((await request(author, 'DELETE', `/quizzes/${q}/attempts/${a}`)).status, 403);
    await admin.query(`UPDATE role_permissions SET effect='deny' WHERE role_id=(SELECT id FROM roles WHERE name='Owner')`);
    assert.equal((await request(owner, 'DELETE', `/quizzes/${q}/attempts/${a}`)).status, 200);
    await admin.query(`UPDATE role_permissions SET effect='deny' WHERE role_id=(SELECT id FROM roles WHERE name='Uploader')
      AND permission_id=(SELECT id FROM permissions WHERE key='quizzes.attempts.read_own')`);
    assert.equal((await request(author, 'GET', `/quizzes/${quizId}/results`)).status, 403);
    assert.equal((await request(owner, 'GET', `/quizzes/${quizId}/results/${attemptId}`)).status, 200);
  });
  await t.test('permission migration rolls back only its own keys and grants', async () => {
    await migrate('1793232000000_add-quiz-attempt-management-permissions.sql', true);
    assert.equal((await admin.query("SELECT count(*)::int AS n FROM permissions WHERE key LIKE 'quizzes.attempts.%'")).rows[0].n, 0);
    assert.equal((await admin.query("SELECT count(*)::int AS n FROM permissions WHERE key='quizzes.participate'")).rows[0].n, 1);
    await migrate('1793232000000_add-quiz-attempt-management-permissions.sql');
    await migrate('1793232000000_add-quiz-attempt-management-permissions.sql');
    assert.equal((await admin.query("SELECT count(*)::int AS n FROM permissions WHERE key LIKE 'quizzes.attempts.%'")).rows[0].n, 4);
  });
});
