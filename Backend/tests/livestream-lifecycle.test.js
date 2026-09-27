import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { mock, test } from 'node:test';
import pg from 'pg';

test('livestream lifecycle, playback policy and analytics against isolated PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const id = '12345678-1234-4234-8234-123456789abc';
  const owner = '12345678-1234-4234-8234-123456789def';
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  t.after(() => client.end());
  await client.query('SET search_path = pg_temp, pg_catalog');
  await client.query(`CREATE TEMP TABLE videos (
    id uuid PRIMARY KEY, title text, uploaded_by uuid, visibility text DEFAULT 'public',
    published_at timestamptz DEFAULT now(), mux_asset_id text, mux_playback_id text,
    mux_status text, playback_policy text DEFAULT 'public', duration_seconds integer,
    updated_at timestamptz DEFAULT now());
    CREATE TEMP TABLE video_views (video_id uuid, user_id uuid, ip_address text, user_agent text,
      last_heartbeat_at timestamptz, watch_duration integer, created_at timestamptz);
    CREATE TEMP TABLE permissions (id serial PRIMARY KEY, key text UNIQUE, description text, group_name text, resource_type text, risk_level text);
    CREATE TEMP TABLE role_permissions (role_id integer, permission_id integer, effect text, UNIQUE(role_id,permission_id));`);
  for (const migration of ['1790467200000_add-video-livestreams.sql', '1790467200002_livestream-lifecycle.sql']) {
    const sql = (await readFile(new URL('../src/database/migrations/' + migration, import.meta.url), 'utf8')).split('-- Down Migration')[0]
      .replaceAll('public.', 'pg_temp.').replace('CREATE TABLE pg_temp.video_livestreams', 'CREATE TEMP TABLE video_livestreams');
    await client.query(sql);
  }
  let stream, asset, calls, reconciled, sequence = 0, failDelete = false;
  const db = {
    query: (sql, params) => client.query(sql.replaceAll('public.', 'pg_temp.'), params),
    async connect() { return { query: this.query, release() {} }; },
  };
  mock.module(new URL('../src/database/index.js', import.meta.url).href, { namedExports: { writePool: db, readPool: db } });
  mock.module(new URL('../src/modules/video-indexing/mux-source.service.js', import.meta.url).href, { namedExports: { reconcileTracks: async (...args) => reconciled.push(args) } });
  const api = resource => ({
    async retrieve(resourceId) {
      const obj = resource === 'stream' ? stream : asset;
      if (!obj || resourceId !== obj.id) throw Object.assign(new Error('missing'), { status: 404 });
      return structuredClone(obj);
    },
    async createPlaybackId(resourceId, { policy }) {
      const obj = resource === 'stream' ? stream : asset;
      const p = { id: `replacement-${++sequence}`, policy };
      obj.playback_ids.push(p);
      return p;
    },
    async deletePlaybackId(resourceId, playbackId) {
      if (failDelete) throw new Error('provider failure');
      const obj = resource === 'stream' ? stream : asset;
      obj.playback_ids = obj.playback_ids.filter(p => p.id !== playbackId);
    },
    async disable(resourceId) { calls.push(['disable', resourceId]); stream.status = 'disabled'; },
    async delete(resourceId) { calls.push(['delete', resourceId]); },
    async update(resourceId, input) { Object.assign(stream, input); },
    async create(input) {
      calls.push(['create', input]);
      stream = { id: 'replacement-stream', status: 'idle', new_asset_settings: input.new_asset_settings, playback_ids: [{ id: 'replacement-live-id', policy: input.playback_policies[0] }] };
      return structuredClone(stream);
    },
  });
  mock.module('@mux/mux-node', { defaultExport: class { video = { liveStreams: api('stream'), assets: api('asset') }; } });
  const { reconcileLivestream } = await import('../src/modules/livestreams/lifecycle.service.js');
  const { muxWebhookInternal } = await import('../src/modules/videos/video/handlers/muxWebhook.js');
  const { updateLivestreamPlaybackPolicyInternal: policy } = await import('../src/modules/livestreams/handlers/updateLivestreamPlaybackPolicy.js');
  const { deleteLivestreamInternal: remove, endLivestreamInternal: end, updateLivestreamSettingsInternal: settings } = await import('../src/modules/livestreams/handlers/manageLivestream.js');
  const { getConcurrentViewersInternal: concurrent } = await import('../src/modules/analytics/handlers/video/getConcurrentViewers.js');
  const { getVideoPlaybackInternal: playback } = await import('../src/modules/videos/video/handlers/getVideoPlayback.js');
  const { requireRecording } = await import('../src/common/videoAccess.js');
  async function reset() {
    await client.query('TRUNCATE videos, video_livestreams, video_views');
    await client.query("INSERT INTO videos(id,title,uploaded_by,kind) VALUES ($1,'Live',$2,'live')", [id, owner]);
    await client.query("INSERT INTO video_livestreams(video_id,mode,max_duration_seconds,mux_live_stream_id,mux_live_playback_id) VALUES ($1,'standard',3600,'stream','live-id')", [id]);
    stream = { id: 'stream', status: 'idle', new_asset_settings: { playback_policies: ['public'] }, playback_ids: [{ id: 'live-id', policy: 'public' }] };
    asset = null; calls = []; reconciled = []; failDelete = false;
  }
  const beginBroadcast = () => {
    stream.status = 'active'; stream.active_asset_id = 'asset';
    asset = { id: 'asset', live_stream_id: 'stream', created_at: String(Math.floor(Date.now() / 1000)), is_live: true, status: 'ready', duration: 10, playback_ids: [{ id: 'asset-id', policy: 'public' }] };
  };
  async function webhook(type, data, created_at = new Date().toISOString()) {
    process.env.MUX_WEBHOOK_SECRET = 'test-webhook-secret';
    const body = Buffer.from(JSON.stringify({ type, data, created_at }));
    const time = Math.floor(Date.now() / 1000);
    const sig = createHmac('sha256', process.env.MUX_WEBHOOK_SECRET).update(`${time}.`).update(body).digest('hex');
    return muxWebhookInternal({ body, headers: { 'mux-signature': `t=${time},v1=${sig}` } });
  }
  await t.test('early ready permits standard/DVR playback but cannot finalize or unlock recording actions', async () => {
    await reset(); beginBroadcast();
    await webhook('video.asset.ready', asset);
    assert.equal((await playback(id)).mux_playback_id, 'live-id');
    await assert.rejects(requireRecording(db, id), { status: 409 });
    await client.query("UPDATE video_livestreams SET mode='dvr' WHERE video_id=$1", [id]);
    assert.equal((await playback(id)).mux_playback_id, 'asset-id');
    assert.equal(reconciled.length, 0);
    assert.equal((await client.query('SELECT recording_finalized_at FROM video_livestreams')).rows[0].recording_finalized_at, null);
  });
  await t.test('completion persists final duration, disables reuse, and stale ready events cannot regress state', async () => {
    asset.is_live = false; asset.duration = 900; stream.status = 'idle'; delete stream.active_asset_id;
    await webhook('video.asset.live_stream_completed', asset);
    await webhook('video.live_stream.active', { id: 'stream', active_asset_id: 'asset' });
    const row = (await client.query('SELECT * FROM video_livestreams')).rows[0];
    assert.equal(row.status, 'ended'); assert.ok(row.recording_finalized_at);
    assert.equal((await client.query('SELECT duration_seconds,kind FROM videos')).rows[0].duration_seconds, 900);
    assert.equal((await playback(id)).stream_type, 'on-demand');
    await requireRecording(db, id);
    assert.ok(calls.some(([op]) => op === 'disable'));
  });
  await t.test('connection timestamps prevent delayed disconnects from undoing a reconnect', async () => {
    await reset(); beginBroadcast();
    await webhook('video.live_stream.disconnected', stream, '2026-01-01T00:00:01Z');
    assert.equal((await client.query('SELECT status FROM video_livestreams')).rows[0].status, 'reconnecting');
    await webhook('video.live_stream.connected', stream, '2026-01-01T00:00:03Z');
    await webhook('video.live_stream.disconnected', stream, '2026-01-01T00:00:02Z');
    assert.equal((await client.query('SELECT status FROM video_livestreams')).rows[0].status, 'live');
  });
  await t.test('deleting a recording preserves the livestream page and removes replay eligibility', async () => {
    asset.is_live = false; stream.status = 'idle'; delete stream.active_asset_id;
    await reconcileLivestream(id);
    asset = null;
    await webhook('video.asset.deleted', { id: 'asset', live_stream_id: 'stream' });
    assert.equal((await client.query('SELECT COUNT(*) FROM videos')).rows[0].count, '1');
    await assert.rejects(playback(id), { status: 409 });
  });
  await t.test('deadline stops playback and disables the provider, and active deletion is refused', async () => {
    await reset(); beginBroadcast(); await reconcileLivestream(id);
    await assert.rejects(remove(id), { status: 409 });
    await client.query("UPDATE video_livestreams SET started_at=now()-interval '2 hours', stop_at=now()-interval '1 hour'");
    await reconcileLivestream(id);
    await assert.rejects(playback(id), { status: 409 });
    assert.equal(stream.status, 'disabled');
  });
  await t.test('scheduled policy change replaces the stream so its future recording inherits the policy', async () => {
    await reset();
    const result = await policy(id, 'signed');
    assert.equal(result.mux_live_playback_id, 'replacement-live-id');
    assert.equal(stream.new_asset_settings.playback_policies[0], 'signed');
    assert.ok(calls.some(([op, value]) => op === 'delete' && value === 'stream'));
    assert.equal((await client.query('SELECT policy_sync_pending FROM video_livestreams')).rows[0].policy_sync_pending, false);
  });
  await t.test('partial active policy change blocks playback and retry repairs both provider resources', async () => {
    await reset(); beginBroadcast(); await reconcileLivestream(id);
    failDelete = true;
    await assert.rejects(policy(id, 'signed'), { status: 502 });
    await assert.rejects(playback(id), { status: 409 });
    failDelete = false;
    await policy(id, 'signed');
    assert.deepEqual(stream.playback_ids.map(p => p.policy), ['signed']);
    assert.deepEqual(asset.playback_ids.map(p => p.policy), ['signed']);
    assert.equal((await client.query('SELECT policy_sync_pending FROM video_livestreams')).rows[0].policy_sync_pending, false);
  });
  await t.test('settings enforce DVR duration, and ending an unused stream cancels it', async () => {
    await reset();
    await assert.rejects(settings(id, { mode: 'dvr', max_duration_seconds: 14400 }), { status: 400 });
    await settings(id, { mode: 'dvr', max_duration_seconds: 14399 });
    assert.equal(stream.max_continuous_duration + stream.reconnect_window, 14399);
    assert.equal((await end(id)).status, 'cancelled');
    await remove(id);
    assert.equal((await client.query('SELECT COUNT(*) FROM videos')).rows[0].count, '0');
  });
  await t.test('concurrent viewers excludes paused and stale sessions and deduplicates viewers', async () => {
    await reset(); beginBroadcast(); await reconcileLivestream(id);
    await client.query(`INSERT INTO video_views(video_id,user_id,last_heartbeat_at,is_playing) VALUES
      ($1,$2,now(),true), ($1,$2,now(),true), ($1,NULL,now(),false), ($1,NULL,now()-interval '1 minute',true)`, [id, owner]);
    assert.equal((await concurrent(id)).concurrent_viewers, 1);
  });
});
