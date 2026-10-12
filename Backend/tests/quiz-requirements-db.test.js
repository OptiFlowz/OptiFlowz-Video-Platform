import assert from 'node:assert/strict';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { mock, test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { errorHandler } from '../src/middleware/error-handler.js';

test('requirement CRUD, authorization, video cards and pagination against session-local PostgreSQL tables', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  await client.connect();
  t.after(() => client.end());
  await client.query('SET search_path TO pg_temp, public');
  await client.query("CREATE TEMP TABLE users (id uuid PRIMARY KEY, status text DEFAULT 'active', authz_version integer DEFAULT 1, full_name text)");
  await client.query(`CREATE TEMP TABLE videos (
    id uuid PRIMARY KEY, uploaded_by uuid REFERENCES users(id), title text,
    thumbnail_url text, mux_thumbnail_time double precision, mux_playback_id text,
    playback_policy text DEFAULT 'public', mux_status text DEFAULT 'ready',
    visibility text DEFAULT 'public', published_at timestamptz DEFAULT now(),
    duration_seconds integer, view_count integer DEFAULT 10, created_at timestamptz DEFAULT now()
  )`);
  await client.query('CREATE TEMP TABLE watch_progress (user_id uuid, video_id uuid, progress_seconds integer, percentage_watched numeric, PRIMARY KEY (user_id, video_id))');
  await client.query('CREATE TEMP TABLE people (id uuid PRIMARY KEY, name text, image_url text)');
  await client.query('CREATE TEMP TABLE video_chairs (video_id uuid, person_id uuid, type text)');
  for (const file of ['1791590400004_add-quizzes.sql', '1791763200000_add-quiz-requirements.sql', '1791763200001_cascade-quiz-requirements-video-delete.sql']) {
    const sql = await readFile(new URL(`../src/database/migrations/${file}`, import.meta.url), 'utf8');
    await client.query(sql.split('-- Down Migration')[0].replaceAll('public.', 'pg_temp.'));
  }
  const owner = randomUUID(), other = randomUUID();
  const quizA = randomUUID(), quizB = randomUUID(), foreignQuiz = randomUUID();
  const ownVideo = randomUUID(), publicVideo = randomUUID(), privateVideo = randomUUID();
  const pendingVideo = randomUUID(), scheduledVideo = randomUUID(), unknownVideo = randomUUID(), signedVideo = randomUUID();
  await client.query("INSERT INTO users(id,full_name) VALUES ($1,'Owner'),($2,'Other')", [owner, other]);
  await client.query("INSERT INTO pg_temp.quizzes(id,user_id,title,question_count) VALUES ($1,$4,'A',1),($2,$4,'B',1),($3,$5,'Foreign',1)", [quizA, quizB, foreignQuiz, owner, other]);
  for (const [id, uploader, title, visibility, duration, policy] of [
    [ownVideo, owner, 'Own private', 'private', 120, 'public'],
    [publicVideo, other, 'Public video', 'public', 60, 'public'],
    [privateVideo, other, 'Hidden private', 'private', 60, 'public'],
    [pendingVideo, owner, 'Processing', 'public', 60, 'public'],
    [scheduledVideo, other, 'Scheduled', 'public', 60, 'public'],
    [unknownVideo, owner, 'Unknown duration', 'private', null, 'public'],
    [signedVideo, owner, 'Signed images', 'private', 90, 'signed'],
  ]) await client.query('INSERT INTO videos(id,uploaded_by,title,visibility,duration_seconds,playback_policy,mux_playback_id,thumbnail_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [id, uploader, title, visibility, duration, policy, `playback-${id}`, 'https://cdn.example.test/thumbnail.jpg']);
  await client.query("UPDATE videos SET mux_status='preparing' WHERE id=$1", [pendingVideo]);
  await client.query("UPDATE videos SET published_at=now()+interval '1 day' WHERE id=$1", [scheduledVideo]);
  await client.query('INSERT INTO watch_progress VALUES ($1,$3,30,25),($2,$3,90,75)', [owner, other, ownVideo]);
  const person = randomUUID();
  await client.query("INSERT INTO people VALUES ($1,'Speaker','https://cdn.example.test/person.jpg')", [person]);
  await client.query("INSERT INTO video_chairs VALUES ($1,$2,'speaker'),($1,$2,'host')", [ownVideo, person]);

  const queries = [];
  const query = (sql, params) => { queries.push(sql); return client.query(sql.replaceAll('public.', 'pg_temp.'), params); };
  mock.module(new URL('../src/database/index.js', import.meta.url).href, {
    namedExports: { writePool: { query, async connect() { return { query, release() {} }; } } },
  });
  const envKeys = ['JWT_SECRET', 'MUX_SIGNING_KEY', 'MUX_PRIVATE_KEY'];
  const previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.JWT_SECRET = 'quiz-requirements-test-secret';
  process.env.MUX_SIGNING_KEY = 'test-image-key';
  process.env.MUX_PRIVATE_KEY = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64');
  t.after(() => { for (const key of envKeys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } });
  const { default: router } = await import('../src/modules/quizzes-engine/quizzes-engine.routes.js');
  const token = jwt.sign({ sub: owner, authzVersion: 1 }, process.env.JWT_SECRET);
  const otherToken = jwt.sign({ sub: other, authzVersion: 1 }, process.env.JWT_SECRET);
  const app = express();
  app.use(express.json());
  app.use('/api/quizzes', router);
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/quizzes/quiz-requirements`;
  async function request(method, path = '', body, bearer = token) {
    const response = await fetch(base + path, {
      method, headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, ...await response.json() };
  }
  const path = (quiz = quizA, video = ownVideo) => `/${quiz}/${video}`;
  const percentageBody = { quiz_id: quizA, video_id: ownVideo, min_watch_percentage: 75.25 };
  async function scenario(name, run) {
    await t.test(name, async () => { await client.query('TRUNCATE pg_temp.quiz_requirements'); await run(); });
  }

  await scenario('all endpoints require access tokens and reject temporary authentication tokens', async () => {
    const temporary = jwt.sign({ sub: owner, purpose: 'two_factor' }, process.env.JWT_SECRET);
    for (const [method, url] of [['POST', ''], ['GET', ''], ['GET', path()], ['PATCH', path()], ['DELETE', path()]]) {
      assert.equal((await request(method, url, undefined, null)).status, 401);
      assert.equal((await request(method, url, undefined, temporary)).status, 401);
    }
  });

  await scenario('creates percentage and seconds requirements and GET returns complete existing video cards', async () => {
    const created = await request('POST', '', percentageBody);
    assert.equal(created.status, 201);
    assert.deepEqual(created.requirement, { ...percentageBody, min_watch_seconds: null, position: 0 });
    const seconds = await request('POST', '', { quiz_id: quizA, video_id: publicVideo, min_watch_seconds: 60, position: 1 });
    assert.equal(seconds.status, 201); assert.equal(seconds.requirement.min_watch_percentage, null);
    const fetched = await request('GET', path());
    assert.equal(fetched.status, 200);
    assert.deepEqual(Object.fromEntries(Object.entries(fetched.requirement).filter(([key]) => key !== 'video_card')), created.requirement);
    const card = fetched.requirement.video_card;
    assert.equal(card.id, ownVideo); assert.equal(card.title, 'Own private'); assert.equal(card.duration_seconds, 120);
    assert.equal(card.uploader_id, owner); assert.equal(card.uploader_name, 'Owner'); assert.equal(card.view_count, 10);
    assert.equal(card.progress_seconds, 30); assert.equal(card.percentage_watched, 25);
    assert.deepEqual(card.people, [{ id: person, name: 'Speaker', image_url: 'https://cdn.example.test/person.jpg' }]);
    assert.equal(card.thumbnail_url, 'https://cdn.example.test/thumbnail.jpg');
    assert.ok(card.created_at); assert.ok(card.mux_thumbnail_url.startsWith('https://image.mux.com/'));
    assert.equal(new URL(card.preview_url).searchParams.get('start'), '30');
    assert.equal(card.media_expires_at, null);
    const list = await request('GET');
    assert.equal(list.requirements.length, 2);
    assert.ok(list.requirements.every(requirement => requirement.video_card.id === requirement.video_id));
    assert.deepEqual(list.sorting, { sortBy: 'position', sortOrder: 'asc' });
  });

  await scenario('signed card media are signed offline for the correct playback ID and image audiences', async () => {
    assert.equal((await request('POST', '', { ...percentageBody, video_id: signedVideo })).status, 201);
    const { video_card: card } = (await request('GET', path(quizA, signedVideo))).requirement;
    assert.ok(card.media_expires_at > Date.now() / 1000);
    for (const [field, audience] of [['mux_thumbnail_url', 't'], ['preview_url', 'g']]) {
      const claims = jwt.verify(new URL(card[field]).searchParams.get('token'), publicKey, { algorithms: ['RS256'], audience, subject: `playback-${signedVideo}` });
      assert.equal(claims.kid, 'test-image-key'); assert.ok(claims.exp >= card.media_expires_at);
    }
  });

  await scenario('quiz ownership and video visibility protect all reads and writes', async () => {
    assert.equal((await request('POST', '', percentageBody)).status, 201);
    for (const method of ['GET', 'PATCH', 'DELETE']) {
      assert.equal((await request(method, path(), method === 'PATCH' ? { position: 1 } : undefined, otherToken)).status, 404);
    }
    assert.equal((await request('GET', `?quiz_id=${quizA}`, undefined, otherToken)).status, 404);
    assert.deepEqual((await request('GET', '', undefined, otherToken)).requirements, []);
    assert.equal((await request('POST', '', { ...percentageBody, quiz_id: foreignQuiz })).status, 404);
    assert.equal((await request('POST', '', { ...percentageBody, quiz_id: randomUUID() })).status, 404);
    for (const video_id of [privateVideo, pendingVideo, scheduledVideo, randomUUID()]) {
      assert.equal((await request('POST', '', { ...percentageBody, video_id })).status, 404);
    }
    assert.equal((await request('GET', path(quizA, randomUUID()))).status, 404);
    assert.equal((await request('PATCH', path(quizA, publicVideo), { position: 1 })).status, 404);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_temp.quiz_requirements')).rows[0].n, 1);
  });

  await scenario('duplicate links return 409 while one video can be linked to multiple quizzes', async () => {
    assert.equal((await request('POST', '', percentageBody)).status, 201);
    assert.equal((await request('POST', '', percentageBody)).status, 409);
    assert.equal((await request('POST', '', { ...percentageBody, quiz_id: quizB })).status, 201);
    queries.length = 0;
    const listed = await request('GET');
    assert.equal(listed.requirements.length, 2);
    assert.ok(listed.requirements.every(requirement => requirement.video_card.id === ownVideo));
    assert.equal(queries.filter(sql => sql.includes('COALESCE(ppl.people')).length, 1);
    assert.equal(queries.filter(sql => sql.includes('uploaded_by AS uploader_id')).length, 1);
  });

  await scenario('duration validation and PATCH threshold merging preserve data after rejected writes', async () => {
    assert.equal((await request('POST', '', { quiz_id: quizA, video_id: ownVideo, min_watch_seconds: 121 })).status, 400);
    assert.equal((await request('POST', '', { quiz_id: quizA, video_id: unknownVideo, min_watch_seconds: 1 })).status, 400);
    assert.equal((await request('POST', '', { ...percentageBody, video_id: unknownVideo })).status, 201);
    assert.equal((await request('POST', '', percentageBody)).status, 201);
    let result = await request('PATCH', path(), { position: 2 });
    assert.equal(result.status, 200); assert.equal(result.requirement.min_watch_percentage, 75.25);
    assert.equal((await request('PATCH', path(), { min_watch_seconds: 60 })).status, 400);
    assert.equal((await request('PATCH', path(), { min_watch_percentage: null })).status, 400);
    result = await request('PATCH', path(), { min_watch_percentage: null, min_watch_seconds: 120 });
    assert.equal(result.status, 200); assert.equal(result.requirement.position, 2);
    assert.equal((await request('PATCH', path(), { min_watch_seconds: 121, position: 99 })).status, 400);
    result = await request('GET', path());
    assert.equal(result.requirement.min_watch_seconds, 120); assert.equal(result.requirement.position, 2);
    await assert.rejects(client.query('UPDATE videos SET duration_seconds=119 WHERE id=$1', [ownVideo]), { code: '23514' });
    result = await request('PATCH', path(), { min_watch_seconds: null, min_watch_percentage: 100, position: 0 });
    assert.equal(result.status, 200); assert.equal(result.requirement.position, 0);
    assert.equal(result.requirement.min_watch_percentage, 100); assert.equal(result.requirement.min_watch_seconds, null);
    assert.equal((await client.query("SELECT count(*)::int AS n FROM pg_temp.quiz_requirements")).rows[0].n, 2);
  });

  await scenario('page metadata and quiz filters include empty quizzes and beyond-last-page totals', async () => {
    for (const [video_id, position] of [[ownVideo, 1], [publicVideo, 2], [unknownVideo, 3]]) {
      assert.equal((await request('POST', '', { ...percentageBody, video_id, position })).status, 201);
    }
    assert.equal((await request('POST', '', { ...percentageBody, quiz_id: foreignQuiz, video_id: publicVideo }, otherToken)).status, 201);
    const page = await request('GET', `?quiz_id=${quizA}&page=2&limit=1&sortOrder=desc`);
    assert.deepEqual(page.pagination, { page: 2, limit: 1, total: 3, totalPages: 3, hasNextPage: true, hasPreviousPage: true });
    assert.deepEqual(page.sorting, { sortBy: 'position', sortOrder: 'desc' });
    assert.equal(page.requirements[0].video_id, publicVideo);
    const empty = await request('GET', `?quiz_id=${quizB}`);
    assert.deepEqual(empty.requirements, []); assert.equal(empty.pagination.totalPages, 0);
    queries.length = 0;
    const beyond = await request('GET', '?page=100&limit=1');
    assert.deepEqual(beyond.requirements, []); assert.equal(beyond.pagination.total, 3);
    assert.equal(beyond.pagination.hasNextPage, false); assert.equal(beyond.pagination.hasPreviousPage, true);
    assert.equal(queries.some(sql => sql.includes('COALESCE(ppl.people')), false);
    assert.equal('total' in beyond, false); assert.equal('offset' in beyond, false);
  });

  await scenario('all sortable fields work in both directions with nulls last and stable tied pages', async () => {
    await client.query(`INSERT INTO pg_temp.quiz_requirements VALUES
      ($1,$3,25,NULL,3),($1,$4,NULL,30,2),($2,$3,75,NULL,1),($2,$5,NULL,60,4)`, [quizA, quizB, ownVideo, publicVideo, signedVideo]);
    const rows = (await client.query('SELECT quiz_id,video_id,min_watch_percentage::float AS min_watch_percentage,min_watch_seconds,position FROM pg_temp.quiz_requirements')).rows;
    const key = requirement => `${requirement.quiz_id}/${requirement.video_id}`;
    for (const sortBy of ['position', 'quiz_id', 'video_id', 'min_watch_percentage', 'min_watch_seconds']) {
      for (const sortOrder of ['asc', 'desc']) {
        const expected = [...rows].sort((a, b) => {
          const left = a[sortBy], right = b[sortBy];
          const compare = left === right ? 0 : left === null ? 1 : right === null ? -1 : (left < right ? -1 : 1) * (sortOrder === 'asc' ? 1 : -1);
          return compare || (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
        });
        const actual = await request('GET', `?sortBy=${sortBy}&sortOrder=${sortOrder}`);
        assert.equal(actual.status, 200); assert.deepEqual(actual.requirements.map(key), expected.map(key));
        assert.deepEqual(actual.sorting, { sortBy, sortOrder });
      }
    }
    await client.query('UPDATE pg_temp.quiz_requirements SET position=0');
    const pages = [];
    for (let page = 1; page <= 4; page++) pages.push(key((await request('GET', `?page=${page}&limit=1`)).requirements[0]));
    assert.deepEqual(pages, rows.map(key).sort());
  });

  await scenario('unavailable linked videos keep requirements and counts while exposing no card', async () => {
    assert.equal((await request('POST', '', { ...percentageBody, video_id: publicVideo })).status, 201);
    await client.query("UPDATE videos SET visibility='private' WHERE id=$1", [publicVideo]);
    try {
      const fetched = await request('GET', path(quizA, publicVideo));
      assert.equal(fetched.status, 200); assert.equal(fetched.requirement.video_card, null);
      const listed = await request('GET');
      assert.equal(listed.pagination.total, 1); assert.equal(listed.requirements[0].video_card, null);
      assert.equal((await request('PATCH', path(quizA, publicVideo), { position: 1 })).status, 404);
      assert.equal((await request('DELETE', path(quizA, publicVideo))).status, 200);
    } finally { await client.query("UPDATE videos SET visibility='public' WHERE id=$1", [publicVideo]); }
  });

  await scenario('malformed input and readonly composite IDs return 400 without writes', async () => {
    for (const [method, url, payload] of [
      ['POST', '', {}], ['POST', '', { ...percentageBody, min_watch_seconds: 1 }],
      ['POST', '', { ...percentageBody, min_watch_percentage: 0 }],
      ['POST', '', { ...percentageBody, min_watch_percentage: 100.01 }],
      ['POST', '', { ...percentageBody, min_watch_percentage: 50.555 }],
      ['POST', '', { ...percentageBody, position: -1 }],
      ['PATCH', path(), {}], ['PATCH', path(), { quiz_id: quizB }], ['PATCH', path(), { video_id: publicVideo }],
      ['GET', `/invalid/${ownVideo}`], ['DELETE', `/${quizA}/invalid`],
      ['GET', '?page=0'], ['GET', '?limit=101'], ['GET', '?quiz_id=invalid'],
      ['GET', '?sortBy=invalid'], ['GET', '?sortOrder=invalid'], ['GET', '?offset=0'],
    ]) assert.equal((await request(method, url, payload)).status, 400, `${method} ${url}`);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_temp.quiz_requirements')).rows[0].n, 0);
  });

  await scenario('requirement removal preserves both resources and parent deletion still cascades', async () => {
    assert.equal((await request('POST', '', percentageBody)).status, 201);
    assert.deepEqual(await request('DELETE', path()), { status: 200, success: true, deleted: true });
    assert.equal((await request('DELETE', path())).status, 404);
    assert.equal((await request('GET', path())).status, 404);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM videos WHERE id=$1', [ownVideo])).rows[0].n, 1);
    const quizResponse = await fetch(base.replace('/quiz-requirements', `/${quizA}`), { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(quizResponse.status, 200);
    assert.equal((await request('POST', '', percentageBody)).status, 201);
    const deleted = await fetch(base.replace('/quiz-requirements', `/${quizA}`), { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    assert.equal(deleted.status, 200);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_temp.quiz_requirements WHERE quiz_id=$1', [quizA])).rows[0].n, 0);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM videos WHERE id=$1', [ownVideo])).rows[0].n, 1);
    // A video may be required by multiple quizzes; deleting it removes all
    // those links, preserving the quizzes and unrelated requirements.
    const thirdQuiz = randomUUID();
    await client.query("INSERT INTO pg_temp.quizzes(id,user_id,title,question_count) VALUES ($1,$2,'C',1)", [thirdQuiz, owner]);
    for (const quiz_id of [quizB, thirdQuiz]) {
      assert.equal((await request('POST', '', { ...percentageBody, quiz_id })).status, 201);
    }
    assert.equal((await request('POST', '', { ...percentageBody, quiz_id: quizB, video_id: publicVideo })).status, 201);
    await client.query('DELETE FROM videos WHERE id=$1', [ownVideo]);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_temp.quiz_requirements WHERE video_id=$1', [ownVideo])).rows[0].n, 0);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_temp.quizzes WHERE id=ANY($1::uuid[])', [[quizB, thirdQuiz]])).rows[0].n, 2);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_temp.quiz_requirements WHERE quiz_id=$1 AND video_id=$2', [quizB, publicVideo])).rows[0].n, 1);
    assert.equal((await request('GET', path(quizB, ownVideo))).status, 404);
  });

  await scenario('foreign key migration rollback restores RESTRICT and reapplying preserves existing links', async () => {
    assert.equal((await request('POST', '', { ...percentageBody, quiz_id: quizB, video_id: publicVideo })).status, 201);
    const sql = await readFile(new URL('../src/database/migrations/1791763200001_cascade-quiz-requirements-video-delete.sql', import.meta.url), 'utf8');
    const [up, down] = sql.replaceAll('public.', 'pg_temp.').split('-- Down Migration');
    await client.query(down);
    await assert.rejects(client.query('DELETE FROM videos WHERE id=$1', [publicVideo]), { code: '23503' });
    assert.equal((await request('GET', path(quizB, publicVideo))).status, 200);
    await client.query(up);
    assert.equal((await request('GET', path(quizB, publicVideo))).status, 200);
    await client.query('DELETE FROM videos WHERE id=$1', [publicVideo]);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_temp.quiz_requirements WHERE video_id=$1', [publicVideo])).rows[0].n, 0);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_temp.quizzes WHERE id=$1', [quizB])).rows[0].n, 1);
  });
});
