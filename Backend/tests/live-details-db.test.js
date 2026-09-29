import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { prepareLiveSchema } from './helpers/live-stream-schema.js';
import { prepareLivePermissions } from './helpers/live-permissions-schema.js';

test('live detail edits and playback replacement against PostgreSQL temporary tables', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  await client.connect(); t.after(() => client.end());
  await prepareLiveSchema(client);
  await client.query("ALTER TABLE pg_temp.users ADD COLUMN status text DEFAULT 'active', ADD COLUMN authz_version integer DEFAULT 1");
  const id = '12345678-1234-4234-8234-123456789012';
  const owner = '12345678-1234-4234-8234-123456789abc';
  const other = '12345678-1234-4234-8234-123456789def';
  await client.query('INSERT INTO pg_temp.users(id) VALUES ($1),($2)', [owner, other]);
  await prepareLivePermissions(client, [owner, other]);
  let calls, failure, sequence;
  const database = {
    release() {},
    async query(sql, params) {
      calls.push(['sql', sql]);
      if (failure === 'update' && sql.startsWith('UPDATE public.live_streams SET playback_policy=')) throw new Error('Injected update failure');
      const result = await client.query(sql.replaceAll('public.', 'pg_temp.'), params);
      if (failure === 'commit' && sql === 'COMMIT') throw new Error('Lost commit response');
      return result;
    },
  };
  mock.module(new URL('../src/database/index.js', import.meta.url).href, { namedExports: {
    writePool: { ...database, async connect() { return database; } },
  } });
  mock.module('@mux/mux-node', { defaultExport: class { video = { liveStreams: {
    async createPlaybackId(streamId, { policy }) {
      calls.push(['create', streamId, policy]);
      if (failure === 'create') throw new Error('Mux unavailable with sensitive data');
      return { id: `new-${++sequence}`, policy: failure === 'invalid' ? 'drm' : policy };
    },
    async deletePlaybackId(streamId, playbackId) {
      calls.push(['delete', streamId, playbackId]);
      if (failure === 'delete') throw new Error('Mux unavailable with sensitive data');
      if (failure === '404') throw Object.assign(new Error('Missing'), { status: 404 });
    },
  } }; } });
  const { updateLiveDetailsInternal: update } = await import('../src/modules/live-streams/handlers/updateLiveDetails.js');
  const { default: router } = await import('../src/modules/live-streams/live-streams.routes.js');
  const input = body => ({ params: { liveStreamId: id }, body });
  const read = async () => (await client.query('SELECT * FROM pg_temp.live_streams WHERE id=$1', [id])).rows[0];
  const remote = () => calls.filter(([name]) => name !== 'sql');
  async function reset(policy = 'public') {
    calls = []; failure = null; sequence = 0;
    await client.query('TRUNCATE pg_temp.live_streams, pg_temp.videos');
    await client.query(`INSERT INTO pg_temp.live_streams(id,user_id,title,description,visibility,playback_policy,
      dvr_enabled,scheduled_at,mux_live_stream_id,mux_live_playback_id)
      VALUES ($1,$2,'Original','Description','public',$3,true,'2026-10-01T10:00:00Z','mux-live','old-id')`, [id, owner, policy]);
  }

  await t.test('partial edits and nullable fields preserve unspecified details and lifecycle', async () => {
    await reset();
    const result = await update(input({ title: '  New title  ', description: null, visibility: 'unlisted', scheduled_at: '2026-10-02T12:00:00+02:00' }), owner);
    assert.equal(result.live_stream.title, 'New title');
    assert.equal(result.live_stream.description, null);
    assert.equal(result.live_stream.visibility, 'unlisted');
    assert.equal(result.live_stream.scheduled_at.toISOString(), '2026-10-02T10:00:00.000Z');
    assert.equal(result.live_stream.dvr_enabled, true);
    assert.equal(result.live_stream.status, 'scheduled');
    assert.equal(result.live_stream.playback_policy, 'public');
    assert.equal(Object.hasOwn(result.live_stream, 'mux_playback_id_pending_deletion'), false);
    await update(input({ scheduled_at: null }), owner);
    assert.equal((await read()).scheduled_at, null);
    assert.equal((await read()).title, 'New title');
    assert.deepEqual(remote(), []);
  });

  for (const [from, to] of [['public', 'signed'], ['signed', 'public']]) {
    await t.test(`${from} to ${to} commits the replacement before deleting the old playback`, async () => {
      await reset(from);
      await client.query("INSERT INTO pg_temp.videos(live_stream_id,title,playback_policy) VALUES ($1,'Existing recording',$2)", [id, from]);
      const result = await update(input({ playback_policy: to, title: 'Updated live' }), owner);
      assert.equal(result.live_stream.playback_policy, to);
      assert.equal(result.live_stream.mux_live_playback_id, 'new-1');
      assert.equal((await read()).mux_playback_id_pending_deletion, null);
      assert.deepEqual(remote(), [['create', 'mux-live', to], ['delete', 'mux-live', 'old-id']]);
      assert.ok(calls.findIndex(([name, sql]) => name === 'sql' && sql === 'COMMIT') < calls.findIndex(([name]) => name === 'delete'));
      const recording = (await client.query('SELECT title, playback_policy FROM pg_temp.videos')).rows[0];
      assert.deepEqual(recording, { title: 'Existing recording', playback_policy: from });
      calls = [];
      await update(input({ playback_policy: to }), owner);
      assert.deepEqual(remote(), []);
    });
  }

  await t.test('validation excludes DVR and unknown fields; ownership is checked before Mux', async () => {
    await reset();
    for (const body of [{}, { dvr_enabled: false }, { title: '' }, { title: null }, { title: 'x'.repeat(513) },
      { scheduled_at: '2026-10-01' }, { playback_policy: 'drm' }, { visibility: 'invalid' }, { user_id: other }, { status: 'live' }]) {
      await assert.rejects(update(input(body), owner), { status: 400 });
    }
    await assert.rejects(update(input({ title: 'Test' })), { status: 401 });
    await assert.rejects(update({ params: { liveStreamId: 'invalid' }, body: { title: 'Test' } }, owner), { status: 400 });
    assert.deepEqual(calls, []);
    await assert.rejects(update(input({ playback_policy: 'signed' }), other), { status: 404 });
    assert.deepEqual(remote(), []);
    assert.equal((await read()).title, 'Original');
  });

  await t.test('Mux create and database failures preserve original playback and remove unused IDs', async () => {
    for (const kind of ['create', 'update', 'invalid']) {
      await reset(); failure = kind;
      await assert.rejects(update(input({ playback_policy: 'signed' }), owner));
      assert.equal((await read()).playback_policy, 'public');
      assert.equal((await read()).mux_live_playback_id, 'old-id');
      assert.deepEqual(remote().filter(([name]) => name === 'delete'), kind === 'create' ? [] : [['delete', 'mux-live', 'new-1']]);
    }
  });

  await t.test('old-ID deletion failure persists the new policy and retry finishes cleanup', async () => {
    await reset(); failure = 'delete';
    await assert.rejects(update(input({ playback_policy: 'signed', description: 'Saved' }), owner), { status: 502 });
    assert.equal((await read()).playback_policy, 'signed');
    assert.equal((await read()).description, 'Saved');
    assert.equal((await read()).mux_playback_id_pending_deletion, 'old-id');
    failure = '404';
    await update(input({ playback_policy: 'signed' }), owner);
    assert.equal((await read()).mux_playback_id_pending_deletion, null);
    assert.equal(remote().filter(([name]) => name === 'create').length, 1);
  });

  await t.test('ambiguous commit keeps the replacement and supports cleanup on retry', async () => {
    await reset(); failure = 'commit';
    await assert.rejects(update(input({ playback_policy: 'signed' }), owner), /Lost commit/);
    assert.equal((await read()).mux_live_playback_id, 'new-1');
    assert.equal(remote().filter(([name]) => name === 'delete').length, 0);
    failure = null;
    await update(input({ playback_policy: 'signed' }), owner);
    assert.equal((await read()).mux_playback_id_pending_deletion, null);
    assert.equal(remote().filter(([name]) => name === 'create').length, 1);
  });

  const oldSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'live-details-test-secret';
  t.after(() => { if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret; });
  const app = express(); app.use(express.json()); app.use('/api/live-streams', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/live-streams/${id}`;
  const headers = user => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ sub: user, purpose: 'access' }, process.env.JWT_SECRET)}` });
  await t.test('PATCH route authenticates, checks ownership and returns updated live details', async () => {
    await reset();
    assert.equal((await fetch(url, { method: 'PATCH' })).status, 401);
    const body = JSON.stringify({ title: 'HTTP title', visibility: 'private' });
    assert.equal((await fetch(url, { method: 'PATCH', headers: headers(other), body })).status, 403);
    const result = await fetch(url, { method: 'PATCH', headers: headers(owner), body });
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('cache-control'), 'private, no-store');
    const response = await result.json();
    assert.equal(response.success, true);
    assert.equal(response.live_stream.title, 'HTTP title');
    assert.equal(response.live_stream.visibility, 'private');
    assert.equal((await fetch(url, { method: 'PATCH', headers: headers(owner), body: JSON.stringify({ dvr_enabled: false }) })).status, 400);
  });
});
