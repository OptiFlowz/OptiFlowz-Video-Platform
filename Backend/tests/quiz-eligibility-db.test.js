import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { mock, test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';

test('quiz eligibility HTTP route against session-local PostgreSQL tables', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  await client.connect();
  t.after(() => client.end());
  await client.query('SET search_path TO pg_temp, public');
  await client.query("CREATE TEMP TABLE users (id uuid PRIMARY KEY, status text DEFAULT 'active', authz_version integer DEFAULT 1)");
  await client.query('CREATE TEMP TABLE videos (id uuid PRIMARY KEY, duration_seconds integer)');
  await client.query('CREATE TEMP TABLE watch_progress (user_id uuid, video_id uuid, total_watch_seconds numeric, PRIMARY KEY (user_id, video_id))');
  for (const file of ['1791590400004_add-quizzes.sql', '1791763200000_add-quiz-requirements.sql', '1792195200001_add-quiz-attempts.sql']) {
    const sql = await readFile(new URL(`../src/database/migrations/${file}`, import.meta.url), 'utf8');
    await client.query(sql.split('-- Down Migration')[0].replaceAll('public.', 'pg_temp.'));
  }
  const owner = randomUUID(), participant = randomUUID(), inactive = randomUUID();
  await client.query('INSERT INTO users(id) VALUES ($1),($2),($3)', [owner, participant, inactive]);
  await client.query("UPDATE users SET status='inactive' WHERE id=$1", [inactive]);
  const queries = [];
  const query = (sql, params) => {
    queries.push(sql);
    return client.query(sql.replaceAll('public.', 'pg_temp.'), params);
  };
  mock.module(new URL('../src/database/index.js', import.meta.url).href, {
    namedExports: { writePool: { query } },
  });
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'quiz-eligibility-test-secret';
  t.after(() => { if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret; });
  const tokenFor = (sub, extra = {}) => jwt.sign({ sub, authzVersion: 1, ...extra }, process.env.JWT_SECRET);
  const token = tokenFor(participant);
  const { default: router } = await import('../src/modules/quizzes-engine/quizzes-engine.routes.js');
  const app = express();
  app.use('/api/quizzes', router);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));

  async function request(quizId, bearer = token, suffix = '') {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/quizzes/${quizId}/eligibility${suffix}`, {
      headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
    });
    return { status: response.status, cache: response.headers.get('cache-control'), body: await response.json() };
  }
  async function quiz(status = 'published', maxAttempts = null) {
    const id = randomUUID();
    await client.query('INSERT INTO pg_temp.quizzes(id,user_id,title,question_count,status,max_attempts) VALUES ($1,$2,\'Quiz\',1,$3,$4)', [id, owner, status, maxAttempts]);
    return id;
  }
  async function attempt(quizId, status, attemptNo, userId = participant, expiresAt = null) {
    const id = randomUUID();
    await client.query(`INSERT INTO pg_temp.quiz_attempts(id,quiz_id,user_id,attempt_no,status,settings_snapshot,expires_at)
      VALUES ($1,$2,$3,$4,$5,'{}',$6)`, [id, quizId, userId, attemptNo, status, expiresAt]);
    return id;
  }
  async function requirement(quizId, percentage = null, seconds = null, duration = 200) {
    const id = randomUUID();
    await client.query('INSERT INTO videos(id,duration_seconds) VALUES ($1,$2)', [id, duration]);
    await client.query(`INSERT INTO pg_temp.quiz_requirements(quiz_id,video_id,min_watch_percentage,min_watch_seconds)
      VALUES ($1,$2,$3,$4)`, [quizId, id, percentage, seconds]);
    return id;
  }
  async function progress(videoId, seconds, userId = participant) {
    await client.query(`INSERT INTO watch_progress(user_id,video_id,total_watch_seconds) VALUES ($1,$2,$3)
      ON CONFLICT (user_id,video_id) DO UPDATE SET total_watch_seconds=EXCLUDED.total_watch_seconds`, [userId, videoId, seconds]);
  }

  await t.test('auth is mandatory, temporary tokens and inactive users cannot access eligibility', async () => {
    const id = await quiz();
    for (const bearer of [null, 'invalid', tokenFor(participant, { purpose: 'two_factor' }), tokenFor(inactive), tokenFor(participant, { authzVersion: 0 })]) {
      assert.equal((await request(id, bearer)).status, 401);
    }
    const invalid = await request('invalid');
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.success, false);
  });

  await t.test('missing, draft and archived quizzes are unavailable even to the creator', async () => {
    for (const id of [randomUUID(), await quiz('draft'), await quiz('archived')]) {
      for (const bearer of [token, tokenFor(owner)]) {
        const result = await request(id, bearer);
        assert.equal(result.status, 200);
        assert.deepEqual(result.body, {
          success: true, can_start: false, can_resume: false, reason: 'quiz_unavailable',
          active_attempt_id: null, attempts_used: null, max_attempts: null, attempts_remaining: null,
        });
      }
    }
  });

  await t.test('published quizzes without requirements are available to participants with unlimited attempts', async () => {
    const id = await quiz();
    await attempt(id, 'submitted', 1);
    const result = await request(id.toUpperCase());
    assert.equal(result.status, 200);
    assert.equal(result.cache, 'private, no-store');
    assert.deepEqual(result.body, {
      success: true, can_start: true, can_resume: false, reason: null,
      active_attempt_id: null, attempts_used: 1, max_attempts: null, attempts_remaining: null,
    });
  });

  await t.test('all watch thresholds use authenticated participant progress and exact boundaries', async () => {
    const id = await quiz();
    const percentageVideo = await requirement(id, 75.25);
    const secondsVideo = await requirement(id, null, 60);
    await progress(percentageVideo, 200, owner);
    await progress(secondsVideo, 200, owner);
    const blocked = await request(id, token, `?user_id=${owner}`);
    assert.equal(blocked.body.reason, 'requirements_not_met');
    assert.equal(blocked.body.can_start, false);
    assert.equal(blocked.body.can_resume, false);
    await progress(percentageVideo, 150.49);
    await progress(secondsVideo, 60);
    assert.equal((await request(id)).body.reason, 'requirements_not_met');
    await progress(percentageVideo, 150.5);
    assert.equal((await request(id)).body.can_start, true);
    await progress(secondsVideo, 59.99);
    assert.equal((await request(id)).body.reason, 'requirements_not_met');
    await progress(secondsVideo, 60);
    await client.query('UPDATE videos SET duration_seconds=NULL WHERE id=$1', [percentageVideo]);
    assert.equal((await request(id)).body.reason, 'requirements_not_met');
    await client.query('UPDATE videos SET duration_seconds=0 WHERE id=$1', [percentageVideo]);
    assert.equal((await request(id)).body.reason, 'requirements_not_met');
  });

  await t.test('active attempt takes priority over changed requirements and exhausted limits', async () => {
    for (const expiresAt of [null, new Date(Date.now() + 600000)]) {
      const id = await quiz('published', 1);
      const activeId = await attempt(id, 'in_progress', 1, participant, expiresAt);
      await requirement(id, null, 60);
      const result = await request(id);
      assert.deepEqual(result.body, {
        success: true, can_start: false, can_resume: true, reason: 'active_attempt',
        active_attempt_id: activeId, attempts_used: 1, max_attempts: 1, attempts_remaining: 0,
      });
      await client.query("UPDATE pg_temp.quizzes SET status='archived' WHERE id=$1", [id]);
      assert.equal((await request(id)).body.reason, 'quiz_unavailable');
    }
  });

  await t.test('all started attempts count toward the limit; other users and quizzes do not', async () => {
    const id = await quiz('published', 3);
    await attempt(id, 'submitted', 1);
    await attempt(id, 'timed_out', 2);
    await attempt(id, 'in_progress', 1, owner);
    await attempt(await quiz(), 'in_progress', 1);
    const result = await request(id, token, `?user_id=${owner}`);
    assert.equal(result.body.can_start, true);
    assert.equal(result.body.active_attempt_id, null);
    assert.equal(result.body.attempts_used, 2);
    assert.equal(result.body.attempts_remaining, 1);
    await attempt(id, 'cancelled', 3);
    assert.equal((await request(id)).body.reason, 'max_attempts_reached');
    await client.query('UPDATE pg_temp.quizzes SET max_attempts=1 WHERE id=$1', [id]);
    const exceeded = await request(id);
    assert.equal(exceeded.body.reason, 'max_attempts_reached');
    assert.equal(exceeded.body.can_start, false);
    assert.equal(exceeded.body.can_resume, false);
    assert.equal(exceeded.body.attempts_remaining, 0);
    await client.query('UPDATE pg_temp.quizzes SET max_attempts=NULL WHERE id=$1', [id]);
    assert.equal((await request(id)).body.can_start, true);
  });

  await t.test('expired attempts cannot resume, still count toward limits, and GET never changes their status', async () => {
    for (const maxAttempts of [1, 2]) {
      const id = await quiz('published', maxAttempts);
      const expiredId = await attempt(id, 'in_progress', 1, participant, new Date(Date.now() - 60000));
      const before = queries.length;
      const result = await request(id);
      assert.equal(result.body.can_resume, false);
      assert.equal(result.body.active_attempt_id, null);
      assert.equal(result.body.attempts_used, 1);
      assert.equal(result.body.reason, maxAttempts === 1 ? 'max_attempts_reached' : null);
      assert.equal(result.body.can_start, maxAttempts === 2);
      assert.ok(queries.slice(before).every(sql => /^\s*SELECT\b/i.test(sql)));
      assert.equal((await client.query('SELECT status FROM pg_temp.quiz_attempts WHERE id=$1', [expiredId])).rows[0].status, 'in_progress');
    }
  });
});
