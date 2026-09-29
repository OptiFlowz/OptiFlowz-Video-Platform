import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mock, test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { prepareLiveSchema } from './helpers/live-stream-schema.js';

test('live playback selects and signs the current resource against PostgreSQL fixtures', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  await client.connect(); t.after(() => client.end());
  await prepareLiveSchema(client);
  await client.query("ALTER TABLE pg_temp.users ADD COLUMN status text DEFAULT 'active', ADD COLUMN authz_version integer DEFAULT 1");
  const id = '12345678-1234-4234-8234-123456789012';
  const owner = '12345678-1234-4234-8234-123456789abc';
  const viewer = '12345678-1234-4234-8234-123456789def';
  await client.query('INSERT INTO pg_temp.users(id) VALUES ($1),($2)', [owner, viewer]);
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keys = ['MUX_SIGNING_KEY', 'MUX_PRIVATE_KEY', 'JWT_SECRET'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, {
    MUX_SIGNING_KEY: 'live-test-signing-key',
    MUX_PRIVATE_KEY: Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64'),
    JWT_SECRET: 'live-playback-test',
  });
  t.after(() => { for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
  let queries = 0, videoId;
  mock.module(new URL('../src/database/index.js', import.meta.url).href, { namedExports: { writePool: {
    async query(sql, params) { queries++; return client.query(sql.replaceAll('public.', 'pg_temp.'), params); },
  } } });
  // Real SDK JWT signing with generated keys; no Mux HTTP calls.
  const { getLivePlaybackInternal: playback } = await import('../src/modules/live-streams/handlers/getLivePlayback.js');
  const { default: router } = await import('../src/modules/live-streams/live-streams.routes.js');
  async function reset(dvr = false, policy = 'public') {
    await client.query('TRUNCATE pg_temp.live_streams, pg_temp.videos');
    await client.query(`INSERT INTO pg_temp.live_streams(id,user_id,title,status,mux_status,dvr_enabled,
      playback_policy,mux_live_stream_id,mux_live_playback_id,mux_active_asset_id)
      VALUES ($1,$2,'Live','live','active',$3,$4,'mux-live','live-playback','current-asset')`, [id, owner, dvr, policy]);
    await client.query(`INSERT INTO pg_temp.videos(live_stream_id,uploaded_by,mux_asset_id,mux_playback_id,mux_status,
      playback_policy,published_at,mux_recording_completed_at)
      VALUES ($1,$2,'old-asset','old-playback','ready',$3,now(),now())`, [id, owner, policy]);
    const result = await client.query(`INSERT INTO pg_temp.videos(live_stream_id,uploaded_by,mux_asset_id,mux_playback_id,mux_status,
      playback_policy,published_at) VALUES ($1,$2,'current-asset','dvr-playback','preparing',$3,NULL) RETURNING id`, [id, owner, policy]);
    videoId = result.rows[0].id;
    queries = 0;
  }

  for (const dvr of [false, true]) for (const policy of ['public', 'signed']) {
    await t.test(`${dvr ? 'DVR' : 'non-DVR'} ${policy} playback uses the correct ID and tokens`, async () => {
      await reset(dvr, policy);
      const before = Math.floor(Date.now() / 1000);
      const result = await playback(id, viewer);
      const expectedId = dvr ? 'dvr-playback' : 'live-playback';
      assert.equal(result.livestream_id, id);
      assert.equal(result.video_id, videoId);
      assert.equal(result.mux_playback_id, expectedId);
      assert.equal(result.playback_source, dvr ? 'asset' : 'live_stream');
      assert.equal(result.playback_mode, dvr ? 'dvr' : 'live');
      assert.equal(result.playback_policy, policy);
      assert.equal(queries, 1);
      if (policy === 'public') {
        assert.equal(result.stream_url, `https://stream.mux.com/${expectedId}.m3u8`);
        assert.deepEqual(result.tokens, {});
        assert.equal(result.expires_at, null);
      } else {
        assert.equal(new URL(result.stream_url).searchParams.get('token'), result.tokens.playback);
        assert.ok(result.expires_at >= before + 3600);
        for (const [name, audience] of Object.entries({ playback: 'v', thumbnail: 't', storyboard: 's' })) {
          const payload = jwt.verify(result.tokens[name], publicKey, { algorithms: ['RS256'], subject: expectedId, audience });
          assert.equal(payload.kid, 'live-test-signing-key');
          assert.ok(payload.exp >= result.expires_at);
          assert.ok(payload.exp <= Math.floor(Date.now() / 1000) + 3600);
        }
      }
      for (const key of ['stream_key', 'mux_live_stream_id', 'mux_active_asset_id']) assert.equal(Object.hasOwn(result, key), false);
    });
  }

  await t.test('DVR uses the asset policy even if the live playback policy has since changed', async () => {
    await reset(true, 'public');
    await client.query("UPDATE pg_temp.live_streams SET playback_policy='signed' WHERE id=$1", [id]);
    assert.equal((await playback(id, viewer)).playback_policy, 'public');
    await client.query("UPDATE pg_temp.live_streams SET playback_policy='public' WHERE id=$1", [id]);
    await client.query("UPDATE pg_temp.videos SET playback_policy='signed' WHERE id=$1", [videoId]);
    assert.ok((await playback(id, viewer)).tokens.playback);
  });

  await t.test('authentication, visibility, missing streams and malformed IDs are enforced', async () => {
    await reset();
    await assert.rejects(playback(id), { status: 401 });
    await assert.rejects(playback('invalid', viewer), { status: 400 });
    assert.equal(queries, 0);
    await assert.rejects(playback(viewer, viewer), { status: 404 });
    await client.query("UPDATE pg_temp.live_streams SET visibility='private' WHERE id=$1", [id]);
    await assert.rejects(playback(id, viewer), { status: 404 });
    assert.equal((await playback(id, owner)).livestream_id, id);
    await client.query("UPDATE pg_temp.live_streams SET visibility='unlisted' WHERE id=$1", [id]);
    assert.equal((await playback(id, viewer)).livestream_id, id);
  });

  await t.test('reconnect playback remains available; scheduled, ended, cancelled, idle and disabled do not', async () => {
    await reset();
    await client.query("UPDATE pg_temp.live_streams SET status='disconnected' WHERE id=$1", [id]);
    assert.equal((await playback(id, viewer)).status, 'disconnected');
    for (const status of ['scheduled', 'ended', 'cancelled']) {
      await client.query('UPDATE pg_temp.live_streams SET status=$2 WHERE id=$1', [id, status]);
      await assert.rejects(playback(id, owner), { status: 409 });
    }
    for (const muxStatus of ['idle', 'disabled']) {
      await client.query("UPDATE pg_temp.live_streams SET status='live',mux_status=$2 WHERE id=$1", [id, muxStatus]);
      await assert.rejects(playback(id, viewer), { status: 409 });
    }
  });

  await t.test('DVR never falls back to a previous session or to non-DVR playback', async () => {
    await reset(true);
    await client.query('UPDATE pg_temp.videos SET mux_playback_id=NULL WHERE id=$1', [videoId]);
    await assert.rejects(playback(id, viewer), { status: 409 });
    await client.query("UPDATE pg_temp.videos SET mux_playback_id='dvr-playback',mux_recording_completed_at=now() WHERE id=$1", [videoId]);
    await assert.rejects(playback(id, viewer), { status: 409 });
    for (const status of ['deleted', 'errored']) {
      await client.query('UPDATE pg_temp.videos SET mux_recording_completed_at=NULL,mux_status=$2 WHERE id=$1', [videoId, status]);
      await assert.rejects(playback(id, viewer), { status: 409 });
    }
    await client.query("UPDATE pg_temp.live_streams SET mux_active_asset_id='new-session' WHERE id=$1", [id]);
    await assert.rejects(playback(id, viewer), { status: 409 });
    await client.query('UPDATE pg_temp.live_streams SET dvr_enabled=false WHERE id=$1', [id]);
    const nonDvr = await playback(id, viewer);
    assert.equal(nonDvr.video_id, null);
    assert.equal(nonDvr.mux_playback_id, 'live-playback');
  });

  await t.test('missing signing keys fail closed, while public playback needs no signing keys', async () => {
    await reset(false, 'signed');
    process.env.MUX_SIGNING_KEY = ''; process.env.MUX_PRIVATE_KEY = '';
    const { getLivePlaybackInternal: noKeys } = await import('../src/modules/live-streams/handlers/getLivePlayback.js?no-keys');
    await assert.rejects(noKeys(id, viewer), { status: 503 });
    await client.query("UPDATE pg_temp.live_streams SET playback_policy='public' WHERE id=$1", [id]);
    assert.deepEqual((await noKeys(id, viewer)).tokens, {});
  });

  const app = express(); app.use('/api/live-streams', router);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/live-streams/${id}/playback`;
  const headers = user => ({ Authorization: `Bearer ${jwt.sign({ sub: user, purpose: 'access' }, process.env.JWT_SECRET)}` });
  await t.test('POST playback route requires authentication and returns non-cacheable playback data', async () => {
    await reset(true, 'signed');
    assert.equal((await fetch(url, { method: 'POST' })).status, 401);
    const response = await fetch(url, { method: 'POST', headers: headers(viewer) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    const body = await response.json();
    assert.equal(body.success, true); assert.equal(body.video_id, videoId); assert.ok(body.tokens.playback);
    await client.query("UPDATE pg_temp.live_streams SET visibility='private' WHERE id=$1", [id]);
    assert.equal((await fetch(url, { method: 'POST', headers: headers(viewer) })).status, 404);
    assert.equal((await fetch(url, { method: 'POST', headers: headers(owner) })).status, 200);
  });
});
