import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, mock, test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const userId = '12345678-1234-4234-8234-123456789def';
const videoId = '12345678-1234-4234-8234-123456789abc';
let calls, failure, permission, savedVideo, savedLive, muxResponse, realClient;
const db = {
  async query(sql, params) {
    if (sql.includes('SELECT id, status, authz_version')) return { rows: [{ id: userId, status: 'active', authz_version: 1 }] };
    if (sql.includes('bool_or')) return { rows: permission === 'missing' ? [] : [{ id: '1', key: 'livestreams.create', has_allow: permission === 'allow', has_deny: permission === 'deny' }] };
    if (sql.includes('FROM user_roles ur')) return { rows: [{ id: '1', name: 'Uploader', position: 3, is_owner: false }] };
    calls.push({ type: 'sql', sql: sql.trim(), params });
    if (realClient) return realClient.query(sql.replaceAll('public.', 'pg_temp.'), params);
    if (sql === 'BEGIN') {
      if (failure === 'begin') throw new Error('begin failed');
    } else if (sql === 'ROLLBACK') {
      savedVideo = savedLive = null;
    } else if (sql === 'COMMIT') {
      if (failure === 'commit') throw new Error('commit acknowledgement lost');
    } else if (sql.includes('INSERT INTO public.videos')) {
      if (failure === 'video') throw new Error('sensitive database message');
      savedVideo = { id: videoId, title: params[0], description: params[1], uploaded_by: params[2], kind: 'live', visibility: params[3], playback_policy: params[4] };
      return { rows: [savedVideo] };
    } else if (sql.includes('INSERT INTO public.video_livestreams')) {
      if (['live', 'cleanup', 'cleanup404'].includes(failure)) throw new Error('live insert failed');
      savedLive = { video_id: params[0], mode: params[1], status: 'scheduled', mux_live_stream_id: params[2], mux_live_playback_id: params[3], scheduled_start_at: params[4], max_duration_seconds: params[5] };
      return { rows: [savedLive] };
    } else assert.fail(`Unexpected SQL: ${sql}`);
    return { rows: [] };
  },
  async connect() {
    calls.push({ type: 'connect' });
    if (failure === 'connect') throw new Error('connection details');
    return { query: db.query, release() { calls.push({ type: 'release' }); } };
  },
};
mock.module(new URL('../src/database/index.js', import.meta.url).href, { namedExports: { writePool: db } });
mock.module('@mux/mux-node', {
  defaultExport: class {
    constructor(options) { calls?.push({ type: 'mux-client', options }); }
    video = { liveStreams: {
      async create(body) {
        calls.push({ type: 'mux-create', body });
        if (failure === 'mux') throw new Error('provider-secret-do-not-expose');
        if (failure === 'mux-validation') throw Object.assign(new Error('SDK error must not be logged'), {
          status: 400,
          error: { error: { type: 'invalid_parameters', messages: [
            'The field "new_asset_settings.passthrough" should be provided as "passthrough"',
            `token_secret=${process.env.MUX_TOKEN_SECRET} stream_key="hidden-stream-key"`,
          ] } },
        });
        // The actual Mux API rejects this otherwise type-valid AssetOptions field.
        assert.equal('passthrough' in body.new_asset_settings, false);
        return muxResponse ?? { id: 'mux-live', stream_key: 'secret-stream-key', playback_ids: [{ id: 'live-playback', policy: body.playback_policies[0] }] };
      },
      async delete(id) {
        calls.push({ type: 'mux-delete', id });
        if (failure === 'cleanup') throw new Error('cleanup unavailable');
        if (failure === 'cleanup404') throw Object.assign(new Error('already gone'), { status: 404 });
      },
    } };
  },
});
const { createLivestreamInternal: create } = await import('../src/modules/livestreams/handlers/createLivestream.js');
const { default: routes } = await import('../src/modules/livestreams/livestream.routes.js');

beforeEach(() => {
  calls = []; failure = null; permission = 'allow'; savedVideo = savedLive = null; muxResponse = null; realClient = null;
  process.env.MUX_TOKEN_ID = 'test-id'; process.env.MUX_TOKEN_SECRET = 'test-secret';
});

test('creates a signed private live video and scheduled stream, returning metadata only', async () => {
  const result = await create({ title: ' Weekly session ' }, userId);
  assert.equal(result.title, 'Weekly session');
  assert.equal(result.kind, 'live');
  assert.equal(result.uploaded_by, userId);
  assert.equal(result.visibility, 'private');
  assert.equal(result.status, 'scheduled');
  assert.equal(result.max_duration_seconds, 43200);
  assert.equal(result.mux_live_playback_id, 'live-playback');
  assert.equal(JSON.stringify(result).includes('secret-stream-key'), false);
  assert.equal('mux_playback_id' in result, false);
  const request = calls.find(c => c.type === 'mux-create').body;
  assert.deepEqual(request.playback_policies, ['signed']);
  assert.deepEqual(request.new_asset_settings.playback_policies, ['signed']);
  assert.equal(request.passthrough, result.id);
  assert.equal('passthrough' in request.new_asset_settings, false);
  assert.equal(request.new_asset_settings.meta.external_id, result.id);
  assert.equal(request.max_continuous_duration + request.reconnect_window, result.max_duration_seconds);
  assert.equal(calls.find(c => c.type === 'mux-client').options.maxRetries, 0);
  assert.equal(calls.at(-2).sql, 'COMMIT');
  assert.equal(calls.at(-1).type, 'release');
});

test('DVR, minimum duration and public playback configuration are passed to Mux consistently', async () => {
  for (const duration of [60, 3600, 14399]) {
    calls = [];
    const result = await create({ title: 'Live', mode: 'dvr', max_duration_seconds: duration, visibility: 'public', playback_policy: 'public', scheduled_start_at: '2027-01-01T18:00:00+01:00' }, userId);
    const request = calls.find(c => c.type === 'mux-create').body;
    assert.equal(result.mode, 'dvr');
    assert.equal(result.max_duration_seconds, duration);
    assert.ok(request.max_continuous_duration >= 60);
    assert.equal(request.max_continuous_duration + request.reconnect_window, duration);
    assert.deepEqual(request.new_asset_settings.playback_policies, ['public']);
    assert.equal(result.scheduled_start_at, '2027-01-01T18:00:00+01:00');
  }
  assert.equal((await create({ title: 'Live', mode: 'dvr' }, userId)).max_duration_seconds, 14399);
});

test('rejects invalid input and owner/provider overrides before any external calls', async () => {
  for (const body of [
    null, {}, { title: ' ' }, { title: 'x'.repeat(256) }, { title: 'Live', mode: 'unknown' },
    { title: 'Live', scheduled_start_at: 'tomorrow' }, { title: 'Live', visibility: 'hidden' },
    { title: 'Live', playback_policy: 'public' }, { title: 'Live', playback_policy: 'drm' },
    ...[0, 59, -1, 43201, 1.5, '3600', null].map(max_duration_seconds => ({ title: 'Live', max_duration_seconds })),
    ...[14400, 20000].map(max_duration_seconds => ({ title: 'Live', mode: 'dvr', max_duration_seconds })),
    ...['uploaded_by', 'user_id', 'kind', 'mux_live_stream_id', 'stream_key', 'status'].map(key => ({ title: 'Live', [key]: 'spoofed' })),
  ]) await assert.rejects(create(body, userId), { status: 400 });
  await assert.rejects(create({ title: 'Live' }), { status: 401 });
  assert.deepEqual(calls, []);
});

test('missing Mux configuration fails before connecting', async () => {
  delete process.env.MUX_TOKEN_SECRET;
  await assert.rejects(create({ title: 'Live' }, userId), { status: 503 });
  assert.deepEqual(calls, []);
});

for (const stage of ['connect', 'begin', 'video', 'mux', 'live', 'cleanup', 'cleanup404', 'commit']) {
  test(`${stage} failure cleans up only when the stream is known to be uncommitted`, async () => {
    failure = stage;
    const logs = mock.method(console, 'error', () => {});
    try {
      await assert.rejects(create({ title: 'Live' }, userId), { status: stage === 'mux' ? 502 : 500 });
      const shouldDelete = ['live', 'cleanup', 'cleanup404'].includes(stage);
      assert.equal(calls.some(c => c.type === 'mux-delete'), shouldDelete);
      assert.equal(calls.some(c => c.type === 'release'), stage !== 'connect');
      assert.equal(calls.some(c => c.sql === 'ROLLBACK'), !['connect', 'begin'].includes(stage));
      assert.equal(JSON.stringify(logs.mock.calls).includes('provider-secret-do-not-expose'), false);
      if (!['connect', 'begin'].includes(stage)) assert.equal(savedVideo, null);
    } finally { logs.mock.restore(); }
  });
}

test('an incomplete Mux response is rolled back and its stream removed', async () => {
  muxResponse = { id: 'incomplete-stream', playback_ids: [] };
  await assert.rejects(create({ title: 'Live' }, userId), { status: 502 });
  assert.equal(savedVideo, null);
  assert.equal(calls.find(c => c.type === 'mux-delete').id, 'incomplete-stream');
});

test('Mux validation diagnostics expose the cause without credentials or an ambiguous-outcome warning', async () => {
  failure = 'mux-validation';
  const logs = mock.method(console, 'error', () => {});
  try {
    await assert.rejects(create({ title: 'Live' }, userId), { status: 502 });
    assert.equal(logs.mock.calls.length, 1);
    const detail = logs.mock.calls[0].arguments[1];
    assert.equal(detail.video_id, videoId);
    assert.equal(detail.status, 400);
    assert.equal(detail.type, 'invalid_parameters');
    assert.match(detail.messages[0], /new_asset_settings.passthrough/);
    const output = JSON.stringify(detail);
    assert.equal(output.includes(process.env.MUX_TOKEN_SECRET), false);
    assert.equal(output.includes('hidden-stream-key'), false);
    assert.equal(output.includes('SDK error must not be logged'), false);
    assert.equal(savedVideo, null);
  } finally { logs.mock.restore(); }
});

let server, baseUrl, token;
before(async () => {
  process.env.JWT_SECRET = 'livestream-test-jwt';
  token = jwt.sign({ sub: userId, authzVersion: 1 }, process.env.JWT_SECRET);
  const app = express();
  app.use(express.json());
  app.use('/api/livestreams', routes);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}/api/livestreams`;
});
after(async () => { await new Promise(resolve => server.close(resolve)); });
const post = (body, authenticated = true) => fetch(baseUrl, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
});

test('HTTP create requires login and livestreams.create, including deny overrides', async () => {
  assert.equal((await post({ title: 'Live' }, false)).status, 401);
  for (const state of ['missing', 'deny']) {
    permission = state;
    const response = await post({ title: 'Live' });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).requiredPermission, 'livestreams.create');
  }
  assert.deepEqual(calls, []);
});

test('HTTP create returns 201 and safe metadata in the standard response envelope', async () => {
  const response = await post({ title: 'Live', mode: 'dvr' });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const result = await response.json();
  assert.equal(result.success, true);
  assert.equal(result.livestream.video_id, videoId);
  assert.equal(result.livestream.mode, 'dvr');
  assert.equal(JSON.stringify(result).includes('secret-stream-key'), false);
});

test('HTTP validation and provider failures retain controlled status and messages', async () => {
  let response = await post({ title: 'Live', mode: 'dvr', max_duration_seconds: 14400 });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).success, false);
  failure = 'mux';
  const logs = mock.method(console, 'error', () => {});
  try {
    response = await post({ title: 'Live' });
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { success: false, message: 'Could not create livestream with Mux' });
  } finally { logs.mock.restore(); }
});

test('creation persists both rows against PostgreSQL with the actual livestream migration', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  realClient = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  await realClient.connect();
  try {
    await realClient.query('SET search_path = pg_temp, pg_catalog');
    await realClient.query(`CREATE TEMP TABLE videos (
      id uuid PRIMARY KEY DEFAULT '${videoId}', title text, description text, uploaded_by uuid,
      visibility text, playback_policy text, published_at timestamptz, created_at timestamptz DEFAULT now()
    )`);
    const sql = await readFile(new URL('../src/database/migrations/1790467200000_add-video-livestreams.sql', import.meta.url), 'utf8');
    await realClient.query(sql.split('-- Down Migration')[0].replaceAll('public.', 'pg_temp.'));
    const result = await create({ title: 'Live', visibility: 'public', mode: 'dvr' }, userId);
    assert.equal(result.kind, 'live');
    assert.ok(result.published_at instanceof Date);
    assert.equal(result.started_at, null);
    const { rows } = await realClient.query('SELECT v.kind,l.mode,l.max_duration_seconds FROM videos v JOIN video_livestreams l ON l.video_id=v.id');
    assert.deepEqual(rows, [{ kind: 'live', mode: 'dvr', max_duration_seconds: 14399 }]);
  } finally { await realClient.end(); realClient = null; }
});
