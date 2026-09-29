import assert from 'node:assert/strict';
import { after, before, beforeEach, mock, test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';

const userId = '12345678-1234-4234-8234-123456789abc';
const videoId = '12345678-1234-4234-8234-123456789def';
let calls, failure, muxStream, records, snapshot;
const client = {
  async query(sql, values) {
    calls.push([sql.trim(), values]);
    if (sql === 'BEGIN') snapshot = structuredClone(records);
    if (sql === 'ROLLBACK') records = snapshot;
    if (failure === 'commit' && sql === 'COMMIT') throw new Error('Commit response lost');
    if (sql.includes('INSERT INTO public.live_streams')) {
      if (failure === 'live-insert') throw new Error('Database live stream insert failed');
      const liveStream = {
        id: 'live-stream-id', user_id: values[0], title: values[1], description: values[2],
        visibility: values[3], playback_policy: values[4], dvr_enabled: values[5],
        scheduled_at: values[6], mux_live_stream_id: values[7], mux_live_playback_id: values[8],
        status: 'scheduled', mux_status: 'idle',
      };
      records.liveStreams.push(liveStream);
      return { rows: [liveStream] };
    }
    return { rows: [] };
  },
  release() { calls.push(['release']); },
};
mock.module(new URL('../src/database/index.js', import.meta.url).href, {
  namedExports: { writePool: {
    async connect() {
      calls.push(['connect']);
      if (failure === 'connect') throw new Error('Database unavailable');
      return client;
    },
    async query(sql) {
      if (sql.includes('bool_or')) return { rows: [{ id: '1', key: 'live_streams.create', has_allow: true, has_deny: false }] };
      if (sql.includes('FROM user_roles')) return { rows: [{ id: '1', name: 'Uploader', position: 3, is_owner: false }] };
      return { rows: [{ id: userId, status: 'active', authz_version: 1 }] };
    },
  } },
});
mock.module('@mux/mux-node', {
  defaultExport: class {
    video = { liveStreams: {
      async create(params, options) {
        calls.push(['create', params, options]);
        if (failure === 'create') throw new Error('Mux error containing secret credentials');
        return structuredClone(muxStream);
      },
      async delete(id) { calls.push(['delete', id]); },
    } };
  },
});
const { createLiveStreamInternal: create } = await import('../src/modules/live-streams/handlers/createLiveStream.js');
const { default: liveStreamRoutes } = await import('../src/modules/live-streams/live-streams.routes.js');

beforeEach(() => {
  calls = [];
  failure = null;
  records = { videos: [], liveStreams: [] };
  snapshot = null;
  muxStream = {
    id: 'mux-live-id', status: 'idle', stream_key: 'encoder-secret',
    playback_ids: [{ id: 'public-id', policy: 'public' }, { id: 'signed-id', policy: 'signed' }],
  };
});

for (const [dvr, duration] of [[true, 14399], [false, 43200]]) {
  test(`DVR ${dvr} creates a signed Mux stream with a ${duration}s limit and saves its owner`, async () => {
    const result = await create({
      title: "  Creator's stream  ", description: ' Description ',
      dvr_enabled: dvr, scheduled_at: '2026-10-01T18:00:00+02:00',
    }, userId);
    assert.deepEqual(calls[0], ['create', {
      playback_policies: ['signed'], new_asset_settings: {
        playback_policies: ['signed'], video_quality: 'plus', max_resolution_tier: '1080p',
      },
      max_continuous_duration: duration, meta: { title: "Creator's stream" },
    }, { maxRetries: 0 }]);
    assert.deepEqual(result.live_stream, {
      id: 'live-stream-id', user_id: userId, title: "Creator's stream", description: 'Description',
      visibility: 'public', playback_policy: 'signed',
      dvr_enabled: dvr, scheduled_at: '2026-10-01T18:00:00+02:00',
      mux_live_stream_id: 'mux-live-id', mux_live_playback_id: 'signed-id',
      status: 'scheduled', mux_status: 'idle',
    });
    assert.equal(result.video, undefined);
    assert.equal(records.videos.length, 0);
    assert.equal(records.liveStreams.length, 1);

    assert.equal(result.stream_key, 'encoder-secret');
    assert.equal(result.max_continuous_duration, duration);
    const insert = calls.find(([sql]) => sql.includes('INSERT'));
    assert.ok(!insert[0].includes("Creator's stream"));
    assert.ok(!insert[1].includes('encoder-secret'));
    const transaction = calls.filter(([sql]) => sql === 'BEGIN' || sql.includes('INSERT') || sql === 'COMMIT');
    assert.equal(transaction.length, 3);
    assert.equal(transaction[0][0], 'BEGIN');
    assert.match(transaction[1][0], /INSERT INTO public.live_streams/);
    assert.equal(transaction[2][0], 'COMMIT');
    assert.deepEqual(calls.slice(-2).map(([name]) => name), ['COMMIT', 'release']);
    assert.ok(!calls.some(([name]) => name === 'delete'));
  });
}

test('optional values default to no DVR and no scheduled date or description', async () => {
  const result = await create({ title: 'Stream' }, userId);
  assert.equal(result.live_stream.dvr_enabled, false);
  assert.equal(result.live_stream.description, null);
  assert.equal(result.live_stream.scheduled_at, null);
  assert.equal(result.live_stream.visibility, 'public');
  assert.equal(result.live_stream.playback_policy, 'signed');
  assert.equal(result.max_continuous_duration, 43200);
});

for (const visibility of ['public', 'unlisted', 'private']) {
  for (const policy of ['public', 'signed']) {
    test(`${visibility} visibility and ${policy} playback are saved and applied to Mux`, async () => {
      const result = await create({ title: 'Stream', visibility, playback_policy: policy }, userId);
      const params = calls.find(([name]) => name === 'create')[1];
      assert.deepEqual(params.playback_policies, [policy]);
      assert.deepEqual(params.new_asset_settings.playback_policies, [policy]);
      assert.equal(params.new_asset_settings.video_quality, 'plus');
      assert.equal(params.new_asset_settings.max_resolution_tier, '1080p');
      assert.equal(result.live_stream.visibility, visibility);
      assert.equal(result.live_stream.playback_policy, policy);
      assert.equal(result.live_stream.mux_live_playback_id, `${policy}-id`);
    });
  }
}

test('explicit null optional values are accepted', async () => {
  const result = await create({ title: 'Stream', description: null, scheduled_at: null }, userId);
  assert.equal(result.live_stream.description, null);
  assert.equal(result.live_stream.scheduled_at, null);
});

test('invalid requests fail before creating any external resource', async () => {
  for (const body of [
    undefined, null, {}, { title: '  ' }, { title: 10 }, { title: 'x'.repeat(513) },
    { title: 'Stream', description: {} }, { title: 'Stream', dvr_enabled: 'false' },
    { title: 'Stream', dvr_enabled: null }, { title: 'Stream', scheduled_at: 'invalid' },
    { title: 'Stream', scheduled_at: '2026-02-30T12:00:00Z' },
    { title: 'Stream', scheduled_at: '2026-10-01T12:00:00' },
    { title: 'Stream', user_id: 'someone-else' }, { title: 'Stream', playback_policy: 'drm' },
    { title: 'Stream', playback_policy: null }, { title: 'Stream', playback_policy: true },
    { title: 'Stream', visibility: 'invalid' }, { title: 'Stream', visibility: null },
    { title: 'Stream', visibility: false },
  ]) {
    await assert.rejects(create(body, userId), { status: 400 });
  }
  await assert.rejects(create({ title: 'Stream' }, null), { status: 401 });
  assert.deepEqual(calls, []);
});

test('Mux failure returns a sanitized upstream error without accessing the database', async () => {
  failure = 'create';
  await assert.rejects(create({ title: 'Stream' }, userId), {
    status: 502, message: 'Unable to create Mux live stream',
  });
  assert.deepEqual(calls.map(([name]) => name), ['create']);
});

test('missing signed playback or encoder key removes the unusable stream', async () => {
  for (const field of ['playback_ids', 'stream_key']) {
    const saved = muxStream[field];
    delete muxStream[field];
    await assert.rejects(create({ title: 'Stream' }, userId), { status: 502 });
    assert.deepEqual(calls.slice(-1), [['delete', 'mux-live-id']]);
    assert.ok(!calls.some(([name]) => name === 'connect'));
    muxStream[field] = saved;
  }
});

for (const stage of ['connect', 'live-insert']) {
  test(`database ${stage} failure deletes the newly created Mux stream`, async () => {
    failure = stage;
    await assert.rejects(create({ title: 'Stream' }, userId), /Database/);
    assert.deepEqual(calls.filter(([name]) => name === 'delete'), [['delete', 'mux-live-id']]);
    assert.deepEqual(records, { videos: [], liveStreams: [] });
    if (stage !== 'connect') {
      assert.ok(calls.some(([name]) => name === 'ROLLBACK'));
      assert.equal(calls.at(-1)[0], 'release');
    }

  });
}

test('ambiguous commit does not delete a possibly persisted Mux stream', async () => {
  failure = 'commit';
  await assert.rejects(create({ title: 'Stream' }, userId), /Commit response lost/);
  assert.ok(!calls.some(([name]) => name === 'delete'));
  assert.equal(calls.at(-1)[0], 'release');
});

let server, baseUrl, token, previousSecret;
before(async () => {
  previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'live-stream-route-test-secret';
  token = jwt.sign({ sub: userId, purpose: 'access', authzVersion: 1 }, process.env.JWT_SECRET);
  const app = express();
  app.use(express.json());
  app.use('/api/live-streams', liveStreamRoutes);
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/live-streams`;
});
after(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

test('HTTP endpoint requires authentication before creating a stream', async () => {
  const response = await fetch(baseUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Stream' }),
  });
  assert.equal(response.status, 401);
  assert.deepEqual(calls, []);
});

test('authenticated HTTP endpoint returns 201 and prevents caching the stream key', async () => {
  const response = await fetch(baseUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title: 'Stream', dvr_enabled: true, visibility: 'unlisted', playback_policy: 'public' }),
  });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.live_stream.user_id, userId);
  assert.equal(body.live_stream.visibility, 'unlisted');
  assert.equal(body.live_stream.playback_policy, 'public');
  assert.equal(body.video, undefined);
  assert.equal(body.live_stream.mux_live_playback_id, 'public-id');
  assert.equal(body.stream_key, 'encoder-secret');
  assert.equal(body.max_continuous_duration, 14399);
});

test('HTTP validation errors return 400 without contacting Mux', async () => {
  const response = await fetch(baseUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title: '' }),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).success, false);
  assert.deepEqual(calls, []);
});
