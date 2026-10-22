import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { mock, test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { installQuizPermissions } from './helpers/quiz-permissions-schema.js';
import { answerSettings, answerSnapshot } from './helpers/quiz-answer-fixtures.js';

test('save answers: authentication, snapshots, grading, feedback and concurrent writes in isolated PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const schema = `quiz_answer_test_${randomUUID().replaceAll('-', '')}`;
  const connectionString = process.env.TEST_DATABASE_URL;
  const admin = new pg.Client({ connectionString, statement_timeout: 10000 });
  await admin.connect();
  const pool = new pg.Pool({ connectionString, max: 6, statement_timeout: 10000, options: `-c search_path=${schema},public` });
  t.after(async () => {
    await pool.end();
    try { await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); } finally { await admin.end(); }
  });
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.query(`SET search_path TO ${schema},public`);
  await admin.query("CREATE TABLE users(id uuid PRIMARY KEY, status text DEFAULT 'active', authz_version integer DEFAULT 1)");
  for (const file of ['1791590400001_add-questions.sql', '1791590400004_add-quizzes.sql',
    '1792195200000_add-quiz-feedback-and-scoring-settings.sql', '1792627200001_add-quiz-questions-per-page.sql', '1792195200001_add-quiz-attempts.sql',
    '1792195200002_add-quiz-attempt-questions-and-answers.sql']) {
    const sql = (await readFile(new URL(`../src/database/migrations/${file}`, import.meta.url), 'utf8')).replaceAll('public.', `${schema}.`);
    await admin.query(sql.split('-- Down Migration')[0]);
  }
  const owner = randomUUID(), other = randomUUID(), noPermission = randomUUID();
  await admin.query('INSERT INTO users(id) VALUES ($1),($2)', [owner, other]);
  await installQuizPermissions(admin, { schema });
  await admin.query('INSERT INTO users(id) VALUES ($1)', [noPermission]);
  let failWrite = false, expireBeforeWrite = false, onLock = null;
  let failSubmit = false, expireBeforeSubmit = false, pauseSubmit = null;
  const queryOn = database => async (sql, params) => {
    if (sql.includes('FOR UPDATE')) onLock?.();
    if (sql.includes("UPDATE public.quiz_attempts a SET status='submitted'")) {
      if (pauseSubmit) await pauseSubmit();
      if (expireBeforeSubmit) {
        expireBeforeSubmit = false;
        await database.query(`UPDATE ${schema}.quiz_attempts SET expires_at=clock_timestamp() WHERE id=$1`, [params[0]]);
      }
    }
    if (expireBeforeWrite && sql.includes('INSERT INTO public.quiz_attempt_answers')) {
      expireBeforeWrite = false;
      await database.query(`UPDATE ${schema}.quiz_attempts SET expires_at=clock_timestamp() WHERE id=$1`, [params[0]]);
    }
    const result = await database.query(sql.replaceAll('public.', `${schema}.`), params);
    if (failSubmit && sql.includes("UPDATE public.quiz_attempts a SET status='submitted'")) {
      failSubmit = false;
      throw new Error('Injected submit failure');
    }
    if (failWrite && sql.includes('INSERT INTO public.quiz_attempt_answers')) { failWrite = false; throw new Error('Injected answer write failure'); }
    return result;
  };
  mock.module(new URL('../src/database/index.js', import.meta.url).href, { namedExports: { writePool: {
    query: queryOn(pool), async connect() { const client = await pool.connect(); return { query: queryOn(client), release: () => client.release() }; },
  } } });
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'quiz-answer-test-secret';
  t.after(() => { if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret; });
  const tokenFor = sub => jwt.sign({ sub, authzVersion: 1 }, process.env.JWT_SECRET);
  const token = tokenFor(owner);
  const { quizAttemptAnswerRoutes } = await import('../src/modules/quizzes-engine/quiz-attempts/quiz-attempts.routes.js');
  const { saveQuizAttemptAnswerInternal: save } = await import('../src/modules/quizzes-engine/quiz-attempts/handlers/saveQuizAttemptAnswer.js');
  const { submitQuizAttemptInternal: submit } = await import('../src/modules/quizzes-engine/quiz-attempts/handlers/submitQuizAttempt.js');
  const { getQuizAttemptsInternal: listAttempts } = await import('../src/modules/quizzes-engine/quiz-attempts/handlers/getQuizAttempts.js');
  const app = express();
  app.use(express.json());
  app.use('/api/quiz-attempts', quizAttemptAnswerRoutes);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  async function request(id, answer = { option_no: 1 }, { questionNo = 1, bearer = token, extra = {} } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/quiz-attempts/${id}/answers/${questionNo}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: JSON.stringify({ answer, ...extra }),
    });
    return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
  }
  async function fixture(type = 'single_choice', settings = {}) {
    const quizId = randomUUID(), id = randomUUID(), questionId = randomUUID();
    await admin.query("INSERT INTO quizzes(id,user_id,title,question_count,status) VALUES($1,$2,'Quiz',1,'archived')", [quizId, owner]);
    await admin.query("INSERT INTO questions(id,user_id,type,content,explanation) VALUES($1,$2,$3,'LIVE content','LIVE explanation')", [questionId, owner, type]);
    await admin.query("INSERT INTO quiz_attempts(id,quiz_id,user_id,attempt_no,settings_snapshot) VALUES($1,$2,$3,1,$4)", [id, quizId, owner, { ...answerSettings, ...settings }]);
    await admin.query('INSERT INTO quiz_attempt_questions(attempt_id,question_no,question_id,question_snapshot,max_points) VALUES($1,1,$2,$3,3)', [id, questionId, answerSnapshot(type)]);
    return { id, quizId, questionId };
  }
  const stored = async id => (await admin.query('SELECT * FROM quiz_attempt_answers WHERE attempt_id=$1', [id])).rows;

  async function getQuestions(id, bearer = token) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/quiz-attempts/${id}/questions`, {
      headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
    });
    return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
  }

  async function submitRequest(id, bearer = token) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/quiz-attempts/${id}/submit`, {
      method: 'POST', headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
    });
    return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
  }
  const attemptRow = async id => (await admin.query('SELECT * FROM quiz_attempts WHERE id=$1', [id])).rows[0];
  async function addQuestion(id, number, points = 3) {
    await admin.query('INSERT INTO quiz_attempt_questions(attempt_id,question_no,question_snapshot,max_points) VALUES($1,$2,$3,$4)',
      [id, number, answerSnapshot(), points]);
  }

  await t.test('submit requires authentication, permission, ownership, in_progress and an unexpired deadline', async () => {
    const { id } = await fixture();
    assert.equal((await submitRequest(id, null)).status, 401);
    assert.equal((await submitRequest(id, tokenFor(noPermission))).status, 403);
    assert.equal((await submitRequest(id, tokenFor(other))).status, 404);
    assert.equal((await submitRequest(randomUUID())).body.code, 'ATTEMPT_NOT_FOUND');
    assert.equal((await submitRequest('bad')).status, 400);
    for (const status of ['submitted', 'timed_out', 'cancelled']) {
      await admin.query('UPDATE quiz_attempts SET status=$2 WHERE id=$1', [id, status]);
      assert.equal((await submitRequest(id)).body.code, 'ATTEMPT_NOT_IN_PROGRESS');
    }
    await admin.query("UPDATE quiz_attempts SET status='in_progress',expires_at=clock_timestamp() WHERE id=$1", [id]);
    assert.equal((await submitRequest(id)).body.code, 'ATTEMPT_EXPIRED');
    assert.equal((await attemptRow(id)).status, 'in_progress');
    assert.equal((await attemptRow(id)).earned_points, null);
  });

  await t.test('submission requirements count checked answers and fully correct questions against all snapshot questions', async () => {
    const { id } = await fixture('multiple_choice', { min_answered_percentage: 100, min_correct_percentage: 100,
      scoring_mode: 'partial_credit', allow_answer_changes_after_check: true });
    await addQuestion(id, 2);
    await admin.query(`INSERT INTO quiz_attempt_answers(attempt_id,question_no,answer) VALUES($1,2,'{"option_no":1}')`, [id]);
    await request(id, { option_nos: [1] });
    const before = await attemptRow(id);
    assert.equal((await submitRequest(id)).body.code, 'MIN_ANSWERED_PERCENTAGE_NOT_MET');
    assert.deepEqual(await attemptRow(id), before);
    await request(id, { option_no: 1 }, { questionNo: 2 });
    assert.equal((await submitRequest(id)).body.code, 'MIN_CORRECT_PERCENTAGE_NOT_MET');
    assert.deepEqual(await attemptRow(id), before);
    await request(id, { option_nos: [1, 2] });
    assert.equal((await submitRequest(id)).status, 200);
    assert.equal((await attemptRow(id)).earned_points, '6.00');
  });

  await t.test('thresholds use exact ratios and snapshot settings; returned object matches list with partial credit and unanswered weights', async () => {
    const { id, quizId } = await fixture('multiple_choice', { min_answered_percentage: 33.34, min_correct_percentage: 0,
      scoring_mode: 'partial_credit', passing_score_percentage: 30 });
    await addQuestion(id, 2, 1);
    await addQuestion(id, 3, 1);
    await request(id, { option_nos: [1] }); // 1.5 / 5 points, 1 / 3 questions answered.
    await admin.query('UPDATE quizzes SET min_answered_percentage=0,passing_score_percentage=99,question_count=100 WHERE id=$1', [quizId]);
    assert.equal((await submitRequest(id)).body.code, 'MIN_ANSWERED_PERCENTAGE_NOT_MET');
    await admin.query(`UPDATE quiz_attempts SET settings_snapshot=settings_snapshot || '{"min_answered_percentage":33.33}' WHERE id=$1`, [id]);
    const answersBefore = await stored(id);
    const response = await submitRequest(id.toUpperCase());
    assert.equal(response.status, 200);
    assert.equal(response.cache, 'private, no-store');
    assert.equal(response.body.status, 'submitted');
    assert.equal(response.body.earned_points, 1.5);
    assert.equal(response.body.max_points, 5);
    assert.equal(response.body.score_percentage, 30);
    assert.equal(response.body.passed, true);
    assert.ok(response.body.finished_at);
    assert.deepEqual(await stored(id), answersBefore);
    const listed = (await listAttempts(quizId, {}, owner)).attempts[0];
    const { success, ...returned } = response.body;
    assert.equal(success, true);
    // JSONB timestamps may use a different ISO representation than pg Date values.
    for (const key of ['started_at', 'expires_at', 'finished_at']) {
      if (listed[key]) listed[key] = new Date(listed[key]).toISOString();
    }
    assert.deepEqual(returned, listed);
    assert.equal((await submitRequest(id)).body.code, 'ATTEMPT_NOT_IN_PROGRESS');
    assert.equal((await request(id, { option_nos: [1, 2] })).body.code, 'ATTEMPT_NOT_IN_PROGRESS');
  });

  await t.test('correctness threshold denominator includes unanswered questions; score rounds to two decimals before passing comparison', async () => {
    const { id } = await fixture('single_choice', { min_correct_percentage: 33.34, passing_score_percentage: 33.33 });
    await addQuestion(id, 2);
    await addQuestion(id, 3);
    await request(id);
    assert.equal((await submitRequest(id)).body.code, 'MIN_CORRECT_PERCENTAGE_NOT_MET');
    await admin.query(`UPDATE quiz_attempts SET settings_snapshot=settings_snapshot || '{"min_correct_percentage":33.33}' WHERE id=$1`, [id]);
    const result = await submitRequest(id);
    assert.equal(result.body.score_percentage, 33.33);
    assert.equal(result.body.passed, true);
    const failed = await fixture('single_choice', { passing_score_percentage: 33.34 });
    await addQuestion(failed.id, 2);
    await addQuestion(failed.id, 3);
    await request(failed.id);
    assert.equal((await submitRequest(failed.id)).body.passed, false);
  });

  await t.test('zero thresholds permit unanswered submission; show_final_score hides returned scores but stores them', async () => {
    const { id } = await fixture('single_choice', { show_final_score: false });
    const result = await submitRequest(id);
    assert.equal(result.status, 200);
    assert.equal(result.body.earned_points, null);
    assert.equal(result.body.score_percentage, null);
    assert.equal(result.body.passed, null);
    assert.equal(result.body.max_points, 3);
    const saved = await attemptRow(id);
    assert.equal(saved.earned_points, '0.00');
    assert.equal(saved.score_percentage, '0.00');
    assert.equal(saved.passed, false);
  });

  await t.test('invalid snapshots, empty pools and incomplete grades reject without finalizing', async () => {
    for (const invalid of ['settings', 'empty', 'grade']) {
      const { id } = await fixture();
      if (invalid === 'settings') await admin.query("UPDATE quiz_attempts SET settings_snapshot='{}' WHERE id=$1", [id]);
      if (invalid === 'empty') await admin.query('DELETE FROM quiz_attempt_questions WHERE attempt_id=$1', [id]);
      if (invalid === 'grade') await admin.query(`INSERT INTO quiz_attempt_answers(attempt_id,question_no,answer,checked_at)
        VALUES($1,1,'{"option_no":1}',clock_timestamp())`, [id]);
      assert.equal((await submitRequest(id)).status, 422);
      assert.equal((await attemptRow(id)).status, 'in_progress');
      assert.equal((await attemptRow(id)).finished_at, null);
    }
  });

  await t.test('submit rollback and write-time expiration preserve state and allow a later retry', async () => {
    const { id } = await fixture();
    await request(id);
    const before = await attemptRow(id);
    failSubmit = true;
    await assert.rejects(submit(id, owner), /Injected submit failure/);
    assert.deepEqual(await attemptRow(id), before);
    expireBeforeSubmit = true;
    assert.equal((await submitRequest(id)).body.code, 'ATTEMPT_EXPIRED');
    assert.deepEqual(await attemptRow(id), before);
    assert.equal((await submitRequest(id)).status, 200);
  });

  await t.test('parallel submit calls finalize only once; a waiting answer cannot change the committed total', async () => {
    const first = await fixture();
    assert.deepEqual((await Promise.all([submitRequest(first.id), submitRequest(first.id)])).map(result => result.status).sort(), [200, 409]);
    const { id } = await fixture('single_choice', { allow_answer_changes_after_check: true });
    await request(id, { option_no: 2 });
    let release, reached, waiting;
    const blocked = new Promise(resolve => { release = resolve; });
    const atUpdate = new Promise(resolve => { reached = resolve; });
    pauseSubmit = async () => { reached(); await blocked; };
    const pendingSubmit = submitRequest(id);
    await atUpdate;
    const atLock = new Promise(resolve => { waiting = resolve; });
    onLock = waiting;
    const pendingAnswer = request(id, { option_no: 1 });
    try { await atLock; } finally { pauseSubmit = null; onLock = null; release(); }
    assert.equal((await pendingSubmit).body.earned_points, 0);
    assert.equal((await pendingAnswer).body.code, 'ATTEMPT_NOT_IN_PROGRESS');
    assert.equal((await stored(id))[0].awarded_points, '0.00');
  });

  await t.test('submit waits for an in-flight answer and checks status/deadline after acquiring its lock', async () => {
    for (const change of ['answer', 'expired', 'submitted']) {
      const { id } = await fixture('single_choice', { min_answered_percentage: 100 });
      const blocker = await pool.connect();
      await blocker.query('BEGIN');
      await blocker.query(`SELECT id FROM ${schema}.quiz_attempts WHERE id=$1 FOR UPDATE`, [id]);
      let reached;
      const atLock = new Promise(resolve => { reached = resolve; });
      onLock = reached;
      const pending = submitRequest(id);
      try {
        await atLock;
        if (change === 'answer') await blocker.query(`INSERT INTO ${schema}.quiz_attempt_answers
          (attempt_id,question_no,answer,checked_at,is_correct,awarded_points) VALUES($1,1,'{"option_no":1}',clock_timestamp(),true,3)`, [id]);
        else await blocker.query(`UPDATE ${schema}.quiz_attempts SET ${change === 'expired' ? 'expires_at=clock_timestamp()' : "status='submitted'"} WHERE id=$1`, [id]);
        await blocker.query('COMMIT');
      } finally { onLock = null; await blocker.query('ROLLBACK'); blocker.release(); }
      const result = await pending;
      if (change === 'answer') { assert.equal(result.status, 200); assert.equal(result.body.earned_points, 3); }
      else assert.equal(result.body.code, change === 'expired' ? 'ATTEMPT_EXPIRED' : 'ATTEMPT_NOT_IN_PROGRESS');
    }
  });

  await t.test('GET authenticates, scopes to the attempt owner and validates IDs', async () => {
    const { id } = await fixture();
    assert.equal((await getQuestions(id, null)).status, 401);
    assert.equal((await getQuestions(id, tokenFor(noPermission))).status, 403);
    assert.equal((await getQuestions(id, tokenFor(other))).status, 404);
    assert.equal((await getQuestions(randomUUID())).body.code, 'ATTEMPT_NOT_FOUND');
    assert.equal((await getQuestions('invalid')).status, 400);
    assert.equal((await getQuestions(id.toUpperCase())).status, 200);
  });

  await t.test('GET returns all snapshots in question order, preserves presentation order and omits answer keys', async () => {
    const { id, quizId, questionId } = await fixture();
    const matching = answerSnapshot('matching');
    matching.matching_items.reverse();
    await admin.query(`INSERT INTO quiz_attempt_questions(attempt_id,question_no,question_snapshot,max_points)
      VALUES ($1,3,$2,2.5),($1,2,$3,4)`, [id, matching, answerSnapshot('multiple_choice')]);
    await admin.query('DELETE FROM questions WHERE id=$1', [questionId]);
    await admin.query("UPDATE quizzes SET correctness_visibility='after_check',correct_answers_visibility='after_check',explanation_visibility='after_check' WHERE id=$1", [quizId]);
    const result = await getQuestions(id);
    assert.equal(result.status, 200);
    assert.equal(result.cache, 'private, no-store');
    assert.equal(result.body.is_expired, false);
    assert.deepEqual(result.body.questions.map(question => question.question_no), [1, 2, 3]);
    assert.deepEqual(result.body.questions.map(question => question.type), ['single_choice', 'multiple_choice', 'matching']);
    assert.equal(result.body.questions[0].question_id, null);
    assert.ok(result.body.questions.every(question => question.answer === null && question.checked_at === null
      && question.updated_at === null && question.can_edit && question.content === 'Snapshot question'));
    assert.deepEqual(result.body.questions[0].options, answerSnapshot().options.map(({ option_no, content, position }) => ({ option_no, content, position })));
    assert.deepEqual(result.body.questions[2].matching_items.map(item => item.item_no), [3, 2, 1]);
    assert.equal(result.body.questions[2].max_points, 2.5);
    assert.doesNotMatch(JSON.stringify(result.body), /is_correct|awarded_points|correct_option_no|SECRET|LIVE|question_snapshot|source_category_id/);
  });

  await t.test('GET reuses PUT feedback and computes editability from checked_at and saved settings', async () => {
    const { id, quizId } = await fixture('single_choice', {
      correctness_visibility: 'after_check', correct_answers_visibility: 'after_check', explanation_visibility: 'after_check',
    });
    const put = await request(id, { option_no: 2 });
    assert.equal(put.status, 200);
    await admin.query(`INSERT INTO quiz_attempt_questions(attempt_id,question_no,question_snapshot)
      VALUES($1,2,$2),($1,3,$2)`, [id, answerSnapshot()]);
    await admin.query(`INSERT INTO quiz_attempt_answers(attempt_id,question_no,answer)
      VALUES($1,2,'{"option_no":1}')`, [id]);
    await admin.query('UPDATE quizzes SET allow_answer_changes_after_check=true WHERE id=$1', [quizId]);
    const before = await stored(id);
    const result = await getQuestions(id);
    const [checked, unchecked, unanswered] = result.body.questions;
    assert.deepEqual(checked.answer, put.body.answer);
    assert.deepEqual(checked.feedback, put.body.feedback);
    assert.equal(new Date(checked.checked_at).getTime(), new Date(put.body.checked_at).getTime());
    assert.equal(checked.can_edit, false);
    assert.deepEqual(unchecked.answer, { option_no: 1 });
    assert.equal(unchecked.checked_at, null);
    assert.deepEqual(unchecked.feedback, {});
    assert.equal(unchecked.can_edit, true);
    assert.equal(unanswered.answer, null);
    assert.equal(unanswered.can_edit, true);
    assert.deepEqual(await stored(id), before);
    await admin.query(`UPDATE quiz_attempts SET settings_snapshot=settings_snapshot || '{"allow_answer_changes_after_check":true}' WHERE id=$1`, [id]);
    assert.equal((await getQuestions(id)).body.questions[0].can_edit, true);
  });

  await t.test('GET expired attempts requires snapshot review permission, reveals allowed finished feedback and never regrades', async () => {
    const { id, quizId } = await fixture('matching', { allow_answer_changes_after_check: true });
    const pairs = [{ item_no: 1, option_no: 1 }, { item_no: 2, option_no: 2 }, { item_no: 3, option_no: 1 }];
    await request(id, { pairs });
    // Deliberately preserve a historical grade that differs from regrading this answer.
    await admin.query('UPDATE quiz_attempt_answers SET is_correct=false,awarded_points=0.25 WHERE attempt_id=$1', [id]);
    await admin.query(`UPDATE quiz_attempts SET expires_at=clock_timestamp(), settings_snapshot=settings_snapshot
      || '{"explanation_incorrect_only":true,"correct_answers_visibility":"never"}' WHERE id=$1`, [id]);
    const before = await stored(id);
    const attemptBefore = (await admin.query('SELECT * FROM quiz_attempts WHERE id=$1', [id])).rows[0];
    const result = await getQuestions(id);
    assert.equal(result.status, 200);
    assert.equal(result.body.is_expired, true);
    assert.equal(result.body.status, 'in_progress');
    assert.equal(result.body.questions[0].can_edit, false);
    assert.deepEqual(result.body.questions[0].feedback, { is_correct: false, awarded_points: 0.25, explanation: 'SECRET explanation' });
    assert.doesNotMatch(JSON.stringify(result.body), /correct_option_no/);
    assert.deepEqual(await stored(id), before);
    assert.deepEqual((await admin.query('SELECT * FROM quiz_attempts WHERE id=$1', [id])).rows[0], attemptBefore);
    await admin.query(`UPDATE quiz_attempts SET settings_snapshot=settings_snapshot || '{"allow_attempt_review":false}' WHERE id=$1`, [id]);
    await admin.query('UPDATE quizzes SET allow_attempt_review=true WHERE id=$1', [quizId]);
    const denied = await getQuestions(id);
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, 'ATTEMPT_REVIEW_NOT_ALLOWED');
    assert.equal(Object.hasOwn(denied.body, 'questions'), false);
  });

  await t.test('GET submitted and timed_out attempts follow snapshot review policy; cancelled attempts are unavailable', async () => {
    for (const status of ['submitted', 'timed_out']) {
      const { id } = await fixture();
      await request(id);
      await admin.query('UPDATE quiz_attempts SET status=$2 WHERE id=$1', [id, status]);
      const before = await stored(id);
      const result = await getQuestions(id);
      assert.equal(result.status, 200);
      assert.equal(result.body.status, status);
      assert.equal(result.body.settings.allow_attempt_review, true);
      assert.equal(result.body.result.status, status);
      assert.equal(result.body.questions[0].can_edit, false);
      assert.equal(result.body.questions[0].feedback.is_correct, true);
      assert.deepEqual(await stored(id), before);
      await admin.query(`UPDATE quiz_attempts SET settings_snapshot=settings_snapshot || '{"allow_attempt_review":false}' WHERE id=$1`, [id]);
      const denied = await getQuestions(id);
      assert.equal(denied.status, 403);
      assert.equal(denied.body.code, 'ATTEMPT_REVIEW_NOT_ALLOWED');
      assert.equal(Object.hasOwn(denied.body, 'questions'), false);
    }
    const { id } = await fixture();
    await admin.query("UPDATE quiz_attempts SET status='cancelled' WHERE id=$1", [id]);
    const blocked = await getQuestions(id);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.code, 'ATTEMPT_NOT_IN_PROGRESS');
    const active = await fixture('single_choice', { allow_attempt_review: false });
    assert.equal((await getQuestions(active.id)).status, 200);
  });

  await t.test('auth and ownership apply even to Owner; bad paths, missing questions and untrusted grading fields fail', async () => {
    const { id } = await fixture();
    assert.equal((await request(id, undefined, { bearer: null })).status, 401);
    assert.equal((await request(id, undefined, { bearer: tokenFor(noPermission) })).status, 403);
    await admin.query("INSERT INTO user_roles SELECT $1,id,NULL FROM roles WHERE name='Owner'", [other]);
    assert.equal((await request(id, undefined, { bearer: tokenFor(other) })).status, 404);
    assert.equal((await request(randomUUID())).body.code, 'ATTEMPT_NOT_FOUND');
    assert.equal((await request('invalid')).status, 400);
    for (const questionNo of ['0', '-1', '1.5', '1e0', '2147483648']) assert.equal((await request(id, undefined, { questionNo })).status, 400);
    assert.equal((await request(id, undefined, { questionNo: 2 })).body.code, 'ATTEMPT_QUESTION_NOT_FOUND');
    assert.equal((await request(id, { option_no: 1, is_correct: true })).status, 400);
    assert.equal((await request(id, { option_no: 1 }, { extra: { user_id: other, awarded_points: 100 } })).status, 400);
    assert.equal((await stored(id)).length, 0);
  });

  await t.test('uses saved settings/question/points even after live deletion; hidden fields never leave the response', async () => {
    const { id, quizId, questionId } = await fixture();
    await admin.query('DELETE FROM questions WHERE id=$1', [questionId]);
    await admin.query("UPDATE quizzes SET correctness_visibility='after_check',correct_answers_visibility='after_check',explanation_visibility='after_check',scoring_mode='partial_credit' WHERE id=$1", [quizId]);
    const response = await request(id.toUpperCase());
    assert.equal(response.status, 200);
    assert.equal(response.cache, 'private, no-store');
    assert.deepEqual(response.body.answer, { option_no: 1 });
    assert.deepEqual(response.body.feedback, {});
    assert.ok(response.body.checked_at);
    assert.doesNotMatch(JSON.stringify(response.body), /is_correct|awarded_points|correct_option_no|SECRET|LIVE|question_snapshot/);
    const [saved] = await stored(id);
    assert.equal(saved.is_correct, true);
    assert.equal(saved.awarded_points, '3.00');
    assert.ok(saved.checked_at);
  });

  await t.test('locked checked answer allows identical retry, rejects a change and preserves the saved result', async () => {
    const { id } = await fixture('multiple_choice');
    const initial = await request(id, { option_nos: [1, 2] });
    assert.equal(initial.status, 200);
    assert.deepEqual((await request(id, { option_nos: [2, 1] })).body, initial.body);
    assert.equal((await request(id, { option_nos: [1] })).body.code, 'ANSWER_LOCKED');
    const [saved] = await stored(id);
    assert.deepEqual(saved.answer, { option_nos: [1, 2] });
    assert.equal(saved.awarded_points, '3.00');
  });

  await t.test('unlimited edits regrade and selectively expose feedback; unchecked prior answers remain editable', async () => {
    const { id } = await fixture('multiple_choice', { allow_answer_changes_after_check: true, scoring_mode: 'partial_credit',
      correctness_visibility: 'after_check', correct_answers_visibility: 'never', explanation_visibility: 'after_check', explanation_incorrect_only: true });
    await admin.query('INSERT INTO quiz_attempt_answers(attempt_id,question_no,answer) VALUES($1,1,$2)', [id, { option_nos: [4] }]);
    const initial = await request(id, { option_nos: [1] });
    assert.equal(initial.status, 200);
    assert.deepEqual(initial.body.feedback, { is_correct: false, awarded_points: 1.5, explanation: 'SECRET explanation' });
    const updated = await request(id, { option_nos: [1, 2] });
    assert.deepEqual(updated.body.feedback, { is_correct: true, awarded_points: 3 });
    assert.equal((await stored(id)).length, 1);
    assert.equal((await stored(id))[0].awarded_points, '3.00');
    assert.equal((await request(id, { option_nos: [3, 4] })).body.feedback.awarded_points, 0);
    const locked = await fixture();
    await admin.query('INSERT INTO quiz_attempt_answers(attempt_id,question_no,answer) VALUES($1,1,$2)', [locked.id, { option_no: 4 }]);
    assert.equal((await request(locked.id)).status, 200);
  });

  await t.test('matching must be complete; repeated option targets are valid and feedback uses snapshot mappings', async () => {
    const { id } = await fixture('matching', { scoring_mode: 'partial_credit', correctness_visibility: 'after_check', correct_answers_visibility: 'after_check' });
    assert.equal((await request(id, { pairs: [{ item_no: 1, option_no: 1 }] })).status, 400);
    assert.equal((await stored(id)).length, 0);
    const result = await request(id, { pairs: [{ item_no: 3, option_no: 2 }, { item_no: 2, option_no: 2 }, { item_no: 1, option_no: 1 }] });
    assert.equal(result.status, 200);
    assert.equal(result.body.feedback.is_correct, false);
    assert.equal(result.body.feedback.awarded_points, 2);
    assert.deepEqual(result.body.feedback.correct_answers.matching_items, [
      { item_no: 1, correct_option_no: 1 }, { item_no: 2, correct_option_no: 2 }, { item_no: 3, correct_option_no: 1 },
    ]);
    assert.equal((await stored(id))[0].awarded_points, '2.00');
  });

  await t.test('finished/cancelled and expired attempts reject writes; write-time deadline is checked again', async () => {
    for (const status of ['submitted', 'timed_out', 'cancelled']) {
      const { id } = await fixture();
      await admin.query('UPDATE quiz_attempts SET status=$2 WHERE id=$1', [id, status]);
      assert.equal((await request(id)).body.code, 'ATTEMPT_NOT_IN_PROGRESS');
      assert.equal((await stored(id)).length, 0);
    }
    const { id } = await fixture();
    await admin.query('UPDATE quiz_attempts SET expires_at=clock_timestamp() WHERE id=$1', [id]);
    assert.equal((await request(id)).body.code, 'ATTEMPT_EXPIRED');
    assert.equal((await stored(id)).length, 0);
    const late = await fixture();
    expireBeforeWrite = true;
    assert.equal((await request(late.id)).body.code, 'ATTEMPT_EXPIRED');
    assert.equal((await stored(late.id)).length, 0);
  });

  await t.test('parallel first answers cannot bypass answer locking, and same-answer retries remain idempotent', async () => {
    const { id } = await fixture();
    const results = await Promise.all([request(id, { option_no: 1 }), request(id, { option_no: 2 })]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    const [saved] = await stored(id);
    assert.deepEqual(results.find(result => result.status === 200).body.answer, saved.answer);
    assert.ok((await Promise.all([request(id, saved.answer), request(id, saved.answer)])).every(result => result.status === 200));
    assert.equal((await stored(id)).length, 1);
  });

  await t.test('deadline and status are checked after waiting for another transaction', async () => {
    for (const change of ["expires_at=clock_timestamp()", "status='submitted'"]) {
      const { id } = await fixture();
      const blocker = await pool.connect();
      await blocker.query('BEGIN');
      await blocker.query(`SELECT id FROM ${schema}.quiz_attempts WHERE id=$1 FOR UPDATE`, [id]);
      let reached;
      const waiting = new Promise(resolve => { reached = resolve; });
      onLock = reached;
      const pending = request(id);
      try {
        await waiting;
        await blocker.query(`UPDATE ${schema}.quiz_attempts SET ${change} WHERE id=$1`, [id]);
        await blocker.query('COMMIT');
      } finally { onLock = null; await blocker.query('ROLLBACK'); blocker.release(); }
      assert.equal((await pending).body.code, change.startsWith('expires') ? 'ATTEMPT_EXPIRED' : 'ATTEMPT_NOT_IN_PROGRESS');
      assert.equal((await stored(id)).length, 0);
    }
  });

  await t.test('failure rolls back the answer and permits a subsequent retry', async () => {
    const { id } = await fixture();
    failWrite = true;
    await assert.rejects(save({ attemptId: id, questionNo: '1' }, { answer: { option_no: 1 } }, owner), /Injected answer write failure/);
    assert.equal((await stored(id)).length, 0);
    assert.equal((await request(id)).status, 200);
  });
});
