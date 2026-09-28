import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { mock, test } from 'node:test';
import pg from 'pg';

test('Mux live lifecycle against PostgreSQL temporary tables', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  await client.connect();
  t.after(() => client.end());
  const previousSecret = process.env.MUX_WEBHOOK_SECRET;
  process.env.MUX_WEBHOOK_SECRET = 'live-webhook-test-secret';
  t.after(() => {
    if (previousSecret === undefined) delete process.env.MUX_WEBHOOK_SECRET;
    else process.env.MUX_WEBHOOK_SECRET = previousSecret;
  });
  // Only connection-local tables are written; production rows are never copied.
  await client.query('CREATE TEMP TABLE videos (LIKE public.videos INCLUDING DEFAULTS INCLUDING CONSTRAINTS)');
  await client.query('ALTER TABLE pg_temp.videos ADD PRIMARY KEY (id)');
  const migrations = [];
  for (const file of ['1790553600000_add-live-streams.sql', '1790553600001_add-live-stream-webhook-state.sql']) {
    const sql = await readFile(new URL(`../src/database/migrations/${file}`, import.meta.url), 'utf8');
    const [up, down] = sql.replaceAll('public.', 'pg_temp.').split('-- Down Migration');
    await client.query(up);
    migrations.push(down);
  }
  await client.query('CREATE TEMP TABLE video_reactions (video_id uuid REFERENCES pg_temp.videos(id) ON DELETE CASCADE, reaction integer)');
  let reconciliations = [], failReconcile = false, failUpdate = false;
  let disableCalls = [], disableFailure = null, released = false, failDisableSave = false;
  const database = {
    async query(sql, params) {
      if (failUpdate && sql.includes('UPDATE public.videos')) throw new Error('Injected database failure');
      if (failDisableSave && sql.includes("SET mux_status = 'disabled'")) throw new Error('Injected disable persistence failure');
      return client.query(sql.replaceAll('public.', 'pg_temp.'), params);
    },
    release() { released = true; },
  };
  mock.module(new URL('../src/database/index.js', import.meta.url).href, {
    namedExports: { writePool: { ...database, async connect() { released = false; return database; } } },
  });
  mock.module('@mux/mux-node', {
    defaultExport: class {
      video = { liveStreams: { async disable(id, options) {
        assert.equal(released, true, 'release database connection before contacting Mux');
        disableCalls.push(id);
        assert.equal(options.maxRetries, 0);
        assert.equal((await client.query('SELECT status FROM pg_temp.live_streams')).rows[0].status, 'ended');
        if (disableFailure) throw Object.assign(new Error('Mux disable failed'), { status: disableFailure });
      } } };
    },
  });
  mock.module(new URL('../src/modules/video-indexing/mux-source.service.js', import.meta.url).href, {
    namedExports: { async reconcileTracks(...args) {
      if (failReconcile) throw new Error('Injected reconciliation failure');
      reconciliations.push(args);
    } },
  });
  const { muxWebhookInternal: webhook } = await import('../src/modules/videos/video/handlers/muxWebhook.js');
  const videoId = crypto.randomUUID();
  const stamp = second => new Date(Date.UTC(2026, 8, 28, 10, 0, second)).toISOString();
  async function reset(overrides = {}) {
    failReconcile = false; failUpdate = false; reconciliations = [];
    disableCalls = []; disableFailure = null; failDisableSave = false;
    await client.query('TRUNCATE pg_temp.video_reactions, pg_temp.live_streams, pg_temp.videos');
    await client.query(`INSERT INTO pg_temp.videos (id,title,visibility,playback_policy,mux_status,like_count)
      VALUES ($1,'Original title','public','signed','preparing',1)`, [videoId]);
    await client.query(`INSERT INTO pg_temp.live_streams (video_id,mux_live_stream_id,mux_live_playback_id,status)
      VALUES ($1,'live-1','live-playback',$2)`, [videoId, overrides.status || 'scheduled']);
    await client.query('INSERT INTO pg_temp.video_reactions VALUES ($1,1)', [videoId]);
  }
  async function state() {
    return (await client.query(`SELECT row_to_json(ls) AS live, row_to_json(v) AS video
      FROM pg_temp.live_streams ls JOIN pg_temp.videos v ON v.id=ls.video_id`)).rows[0];
  }
  async function deliver(type, second, data, createdAt = stamp(second)) {
    const body = Buffer.from(JSON.stringify({ id: crypto.randomUUID(), type, created_at: createdAt, data }));
    const timestamp = Math.floor(Date.now() / 1000);
    const hash = crypto.createHmac('sha256', process.env.MUX_WEBHOOK_SECRET).update(`${timestamp}.`).update(body).digest('hex');
    return webhook({ body, headers: { 'mux-signature': `t=${timestamp},v1=${hash}` } });
  }
  const live = (type, second, extra = {}) => deliver(`video.live_stream.${type}`, second, {
    id: 'live-1', active_asset_id: 'asset-1', status: ['active', 'disconnected'].includes(type) ? 'active' : 'idle', ...extra,
  });
  const asset = (type, second, extra = {}) => deliver(`video.asset.${type}`, second, {
    id: 'asset-1', live_stream_id: 'live-1', status: 'ready', duration: 120.4,
    playback_ids: [{ policy: 'public', id: 'wrong-policy' }, { policy: 'signed', id: 'recording-playback' }], ...extra,
  });

  await t.test('complete lifecycle, reconnect, final recording and duplicate completion', async () => {
    await reset();
    await live('created', 0, { active_asset_id: null });
    await live('idle', 0, { active_asset_id: null });
    assert.equal((await state()).live.status, 'scheduled');
    await live('connected', 1);
    await asset('created', 2, { status: 'preparing', duration: undefined, playback_ids: [] });
    await live('recording', 3);
    assert.equal((await state()).live.mux_status, 'idle');
    await live('active', 4);
    await asset('ready', 5, { duration: 10 });
    let current = await state();
    assert.equal(current.live.status, 'live');
    assert.equal(current.video.mux_playback_id, 'recording-playback');
    assert.equal(current.video.mux_status, 'preparing');
    assert.equal(current.video.published_at, null);
    assert.equal(reconciliations.length, 0);
    assert.deepEqual(disableCalls, []);
    await live('disconnected', 6);
    assert.equal((await state()).live.status, 'live');
    assert.equal((await state()).live.ended_at, null);
    assert.deepEqual(disableCalls, []);
    await live('connected', 7, { status: 'active' });
    await live('active', 8);
    await live('disconnected', 9);
    await live('idle', 10);
    assert.deepEqual(disableCalls, ['live-1']);
    assert.equal((await state()).live.mux_status, 'disabled');
    assert.equal((await state()).video.mux_status, 'preparing');
    await asset('live_stream_completed', 11);
    await asset('live_stream_completed', 11);
    current = await state();
    assert.equal(current.live.status, 'ended');
    assert.equal(current.live.mux_status, 'disabled');
    assert.deepEqual(disableCalls, ['live-1']);
    for (const [column, second] of [['started_at', 4], ['connected_at', 7], ['disconnected_at', 9], ['ended_at', 10], ['completed_at', 11]]) {
      assert.equal(new Date(current.live[column]).toISOString(), stamp(second));
    }
    assert.equal(current.video.id, videoId);
    assert.equal(current.video.mux_asset_id, 'asset-1');
    assert.equal(current.video.duration_seconds, 120);
    assert.equal(current.video.mux_status, 'ready');
    assert.equal(current.video.title, 'Original title');
    assert.equal(current.video.like_count, 1);
    assert.equal(current.video.visibility, 'public');
    assert.equal(current.video.published_at, null);
    assert.deepEqual(reconciliations, [['asset-1', videoId], ['asset-1', videoId]]);
  });

  await t.test('completion delivered first survives delayed active, created and ready events', async () => {
    await reset();
    await asset('live_stream_completed', 20, { duration: 500 });
    await asset('created', 1, { status: 'preparing' });
    await asset('ready', 4, { duration: 10 });
    await asset('ready', 20, { duration: 10 });
    await live('active', 3);
    await live('connected', 2);
    const current = await state();
    assert.equal(current.live.status, 'ended');
    assert.equal(current.live.mux_status, 'disabled');
    assert.deepEqual(disableCalls, ['live-1']);
    assert.equal(current.video.duration_seconds, 500);
    assert.equal(current.video.mux_status, 'ready');
    assert.equal(new Date(current.live.started_at).toISOString(), stamp(3));
  });

  await t.test('late completion after a newer ready event still finalizes the recording', async () => {
    await reset();
    await asset('ready', 21);
    await asset('live_stream_completed', 20);
    assert.equal((await state()).video.mux_status, 'ready');
    assert.equal((await state()).live.status, 'ended');
  });

  await t.test('completed but still preparing waits for a later ready asset', async () => {
    await reset();
    await asset('live_stream_completed', 20, { status: 'preparing', playback_ids: [] });
    assert.equal((await state()).video.mux_status, 'preparing');
    await asset('ready', 21);
    assert.equal((await state()).video.mux_status, 'ready');
  });

  await t.test('ready at the completion timestamp supplies playback without replacing final duration', async () => {
    await reset();
    await asset('live_stream_completed', 20, { status: 'preparing', duration: 500, playback_ids: [] });
    await asset('ready', 20, { duration: 10 });
    assert.equal((await state()).video.mux_status, 'ready');
    assert.equal((await state()).video.mux_playback_id, 'recording-playback');
    assert.equal((await state()).video.duration_seconds, 500);
  });

  await t.test('disconnected delivered before active preserves live state and reconnect timestamps', async () => {
    await reset();
    await live('disconnected', 6);
    await live('active', 4);
    await live('connected', 7, { status: 'active' });
    await live('disconnected', 5);
    const current = await state();
    assert.equal(current.live.status, 'live');
    assert.equal(current.live.mux_status, 'active');
    assert.equal(current.live.ended_at, null);
    assert.equal(new Date(current.live.connected_at).toISOString(), stamp(7));
    assert.equal(new Date(current.live.disconnected_at).toISOString(), stamp(6));
  });

  await t.test('disabled/enabled events ignore older snapshots and preserve cancellation', async () => {
    await reset();
    await live('disabled', 10, { active_asset_id: null });
    await live('enabled', 9, { active_asset_id: null });
    assert.equal((await state()).live.mux_status, 'disabled');
    await live('enabled', 11, { active_asset_id: null });
    assert.equal((await state()).live.mux_status, 'idle');
    await reset({ status: 'cancelled' });
    await live('active', 1);
    await asset('live_stream_completed', 20);
    assert.equal((await state()).live.status, 'cancelled');
  });

  await t.test('a metadata update arriving first does not suppress the active notification', async () => {
    await reset();
    await live('updated', 10);
    await live('active', 4);
    assert.equal((await state()).live.status, 'live');
    assert.equal((await state()).live.mux_status, 'active');
  });

  await t.test('deleting the recording during a broadcast does not block the end notification', async () => {
    await reset();
    await live('active', 4);
    await asset('deleted', 10);
    await live('idle', 20);
    await asset('live_stream_completed', 21);
    const current = await state();
    assert.equal(current.live.status, 'ended');
    assert.equal(current.live.mux_status, 'disabled');
    assert.equal(new Date(current.live.completed_at).toISOString(), stamp(21));
    assert.equal(current.video.mux_status, 'deleted');
    assert.equal(current.video.mux_playback_id, null);
  });

  await t.test('invalid event timestamps return 400 and do not change state', async () => {
    await reset();
    await assert.rejects(deliver('video.live_stream.active', 1, { id: 'live-1' }, 'invalid'), { status: 400 });
    assert.equal((await state()).live.status, 'scheduled');
  });

  await t.test('deleting a Mux live resource preserves its recording and reactions', async () => {
    await reset();
    await asset('live_stream_completed', 20);
    await live('deleted', 21, { active_asset_id: null });
    const current = await state();
    assert.equal(current.live.mux_status, 'disabled');
    assert.equal(current.video.mux_status, 'ready');
    assert.equal(current.video.mux_playback_id, 'recording-playback');
    assert.equal((await client.query('SELECT count(*)::int AS count FROM pg_temp.video_reactions')).rows[0].count, 1);
    await reset();
    await live('deleted', 1, { active_asset_id: null });
    assert.equal((await state()).live.status, 'cancelled');
  });

  await t.test('recording deletion without live_stream_id preserves content and blocks delayed ready events', async () => {
    await reset();
    await asset('live_stream_completed', 20);
    await asset('deleted', 21, { live_stream_id: undefined });
    await asset('ready', 22);
    const current = await state();
    assert.equal(current.video.mux_status, 'deleted');
    assert.equal(current.video.mux_playback_id, null);
    assert.equal(current.video.mux_asset_id, 'asset-1');
    assert.equal(current.video.like_count, 1);
    assert.equal((await client.query('SELECT count(*)::int AS count FROM pg_temp.video_reactions')).rows[0].count, 1);
  });

  await t.test('error snapshots cannot be undone by older ready or completion events', async () => {
    await reset();
    await asset('errored', 21);
    await asset('ready', 10);
    await asset('live_stream_completed', 20);
    assert.equal((await state()).video.mux_status, 'errored');
    assert.equal((await state()).live.status, 'ended');
  });

  await t.test('a new broadcast on the same Mux key cannot replace the original recording', async () => {
    await reset();
    await asset('live_stream_completed', 20);
    await live('active', 25, { active_asset_id: 'asset-2' });
    await asset('ready', 26, { id: 'asset-2' });
    await asset('live_stream_completed', 30, { id: 'asset-2' });
    const current = await state();
    assert.equal(current.video.mux_asset_id, 'asset-1');
    assert.equal(new Date(current.live.completed_at).toISOString(), stamp(20));
    assert.equal(current.live.status, 'ended');
  });

  await t.test('a wrong playback policy is never used as a fallback', async () => {
    await reset();
    await asset('live_stream_completed', 20, { playback_ids: [{ id: 'public-id', policy: 'public' }] });
    assert.equal((await state()).video.mux_playback_id, null);
    assert.equal((await state()).video.mux_status, 'preparing');
  });

  await t.test('database failure rolls back both lifecycle and asset state', async () => {
    await reset();
    failUpdate = true;
    await assert.rejects(live('active', 4), { status: 500 });
    failUpdate = false;
    const current = await state();
    assert.equal(current.live.status, 'scheduled');
    assert.equal(current.live.started_at, null);
    assert.equal(current.video.mux_asset_id, null);
  });

  await t.test('a retry recovers failed post-commit transcript reconciliation', async () => {
    await reset();
    failReconcile = true;
    await assert.rejects(asset('live_stream_completed', 20), { status: 500 });
    assert.equal((await state()).video.mux_status, 'ready');
    failReconcile = false;
    await asset('live_stream_completed', 20);
    assert.deepEqual(reconciliations, [['asset-1', videoId]]);
  });

  await t.test('Mux disable failure preserves ended state and webhook retry finishes disabling', async () => {
    await reset();
    await live('active', 4);
    disableFailure = 503;
    await assert.rejects(live('idle', 20), { status: 502, message: 'Unable to disable ended Mux live stream' });
    assert.equal((await state()).live.status, 'ended');
    assert.equal((await state()).live.mux_status, 'idle');
    disableFailure = null;
    await live('idle', 20);
    assert.equal((await state()).live.mux_status, 'disabled');
    assert.deepEqual(disableCalls, ['live-1', 'live-1']);
  });

  await t.test('a lost database confirmation retries the idempotent Mux disable', async () => {
    await reset();
    failDisableSave = true;
    await assert.rejects(asset('live_stream_completed', 20), { status: 500 });
    assert.equal((await state()).live.status, 'ended');
    assert.equal((await state()).live.mux_status, 'idle');
    failDisableSave = false;
    await asset('live_stream_completed', 20);
    assert.equal((await state()).live.mux_status, 'disabled');
    assert.deepEqual(disableCalls, ['live-1', 'live-1']);
  });

  await t.test('a missing Mux live resource is already unable to broadcast', async () => {
    await reset();
    disableFailure = 404;
    await asset('live_stream_completed', 20);
    assert.equal((await state()).live.mux_status, 'disabled');
    assert.equal((await state()).video.mux_status, 'ready');
  });

  await t.test('enabling an ended stream triggers disable again and failures remain retryable', async () => {
    await reset();
    await asset('live_stream_completed', 20);
    disableFailure = 503;
    await assert.rejects(live('enabled', 25, { active_asset_id: null }), { status: 502 });
    assert.equal((await state()).live.status, 'ended');
    assert.equal((await state()).live.mux_status, 'idle');
    disableFailure = null;
    await live('enabled', 25, { active_asset_id: null });
    assert.equal((await state()).live.mux_status, 'disabled');
    assert.deepEqual(disableCalls, ['live-1', 'live-1', 'live-1']);
  });

  for (const down of migrations.reverse()) await client.query(down);
});
