import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { prepareLiveSchema } from './helpers/live-stream-schema.js';
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
  await prepareLiveSchema(client);
  const previousR2 = { R2_PUBLIC_BASE_URL: process.env.R2_PUBLIC_BASE_URL, R2_BUCKET: process.env.R2_BUCKET };
  process.env.R2_PUBLIC_BASE_URL = 'https://r2.example.test';
  process.env.R2_BUCKET = 'test-bucket';
  t.after(() => { for (const [key, value] of Object.entries(previousR2)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
  let storageCalls = [], failCopy = false;
  mock.module(new URL('../src/modules/storage/r2.client.js', import.meta.url).href, {
    namedExports: { s3: { async send(command) {
      storageCalls.push(command);
      if (failCopy && command.constructor.name === 'CopyObjectCommand') throw new Error('Injected copy failure');
      return {};
    } } },
  });
  // Exercise the real scheduleOverview SQL using only connection-local tables.
  await client.query('CREATE TEMP TABLE video_indexing_sources (LIKE public.video_indexing_sources INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)');
  await client.query('CREATE TEMP TABLE video_indexing_jobs (LIKE public.video_indexing_jobs INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)');
  const ownerId = crypto.randomUUID();
  await client.query('INSERT INTO pg_temp.users VALUES ($1)', [ownerId]);
  await client.query('CREATE TEMP TABLE video_reactions (video_id uuid REFERENCES pg_temp.videos(id) ON DELETE CASCADE, reaction integer)');
  let reconciliations = [], failReconcile = false, failUpdate = false;
  let disableCalls = [], disableFailure = null, released = false, failDisableSave = false;
  let failOverview = false;
  let assetPlaybacks, playbackCalls, failPlaybackDelete;
  const database = {
    async query(sql, params) {
      if (failUpdate && sql.includes('UPDATE public.videos')) throw new Error('Injected database failure');
      if (failOverview && sql.includes('INSERT INTO video_indexing_sources')) throw new Error('Injected overview failure');
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
      } }, assets: {
        async retrieve(id) { playbackCalls.push(['retrieve', id]); return { playback_ids: structuredClone(assetPlaybacks) }; },
        async createPlaybackId(id, { policy }) {
          playbackCalls.push(['create', id, policy]);
          const playback = { id: 'replacement-recording-playback', policy };
          assetPlaybacks.push(playback);
          return playback;
        },
        async deletePlaybackId(id, playbackId) {
          playbackCalls.push(['delete', id, playbackId]);
          if (failPlaybackDelete) throw new Error('Injected playback cleanup failure');
          assetPlaybacks = assetPlaybacks.filter(p => p.id !== playbackId);
        },
      } };
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
    failOverview = false;
    assetPlaybacks = [{ id: 'public-id', policy: 'public' }]; playbackCalls = []; failPlaybackDelete = false;
    storageCalls = []; failCopy = false;
    disableCalls = []; disableFailure = null; failDisableSave = false;
    await client.query('TRUNCATE pg_temp.video_indexing_jobs, pg_temp.video_indexing_sources, pg_temp.video_reactions, pg_temp.live_streams, pg_temp.videos');
    await client.query(`INSERT INTO pg_temp.videos (id,title,visibility,playback_policy,mux_status,like_count)
      VALUES ($1,'Original title','public','signed','preparing',1)`, [videoId]);
    await client.query(`INSERT INTO pg_temp.live_streams (user_id,title,visibility,playback_policy,mux_live_stream_id,mux_live_playback_id,status,scheduled_at)
      VALUES ($1,'Original title','public','signed','live-1','live-playback',$2,$3)`, [ownerId, overrides.status || 'scheduled', overrides.scheduled_at ?? null]);
    await client.query('UPDATE pg_temp.videos SET live_stream_id=(SELECT id FROM pg_temp.live_streams), uploaded_by=$1', [ownerId]);
    await client.query('INSERT INTO pg_temp.video_reactions VALUES ($1,1)', [videoId]);
  }
  async function state() {
    return (await client.query(`SELECT row_to_json(ls) AS live, row_to_json(v) AS video
      FROM pg_temp.live_streams ls JOIN pg_temp.videos v ON v.live_stream_id=ls.id ORDER BY v.created_at,v.id`)).rows[0];
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

  for (const thumbnail of [null, 'https://r2.example.test/live-stream-thumbnails/live/thumbnail.webp']) {
    await t.test(`new recording copies thumbnail ${thumbnail} and schedules overview once`, async () => {
      await reset();
      // Remove the migrated placeholder so this exercises a new recording INSERT.
      await client.query('DELETE FROM pg_temp.videos');
      await client.query('UPDATE pg_temp.live_streams SET thumbnail_url=$1', [thumbnail]);
      await live('recording', 1);
      const created = (await state()).video;
      if (thumbnail) {
        assert.ok(created.thumbnail_url.startsWith(`https://r2.example.test/video-thumbnails/${created.id}/`));
        assert.equal(storageCalls.length, 1);
        assert.equal(storageCalls[0].constructor.name, 'CopyObjectCommand');
        assert.equal(storageCalls[0].input.CopySource, 'test-bucket/live-stream-thumbnails/live/thumbnail.webp');
        assert.equal(created.thumbnail_url, `https://r2.example.test/${storageCalls[0].input.Key}`);
      } else {
        assert.equal(created.thumbnail_url, null);
        assert.equal(storageCalls.length, 0);
      }
      const overview = (await client.query('SELECT * FROM pg_temp.video_indexing_sources')).rows;
      assert.equal(overview.length, 1);
      assert.equal(overview[0].video_id, created.id);
      assert.equal(overview[0].document_type, 'overview');
      await live('recording', 1);
      await asset('ready', 2);
      await asset('live_stream_completed', 3);
      await asset('updated', 4);
      assert.equal((await state()).video.thumbnail_url, created.thumbnail_url);
      assert.equal(storageCalls.length, thumbnail ? 1 : 0, 'retries must not copy again');
      assert.equal((await state()).video.id, created.id);
      assert.deepEqual((await client.query('SELECT * FROM pg_temp.video_indexing_sources')).rows, overview);
      const jobs = (await client.query('SELECT * FROM pg_temp.video_indexing_jobs')).rows;
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].source_id, overview[0].id);
      assert.equal(jobs[0].status, 'pending');
    });
  }

  await t.test('copy failure rolls back recording creation and retry creates an independent thumbnail', async () => {
    await reset();
    await client.query('DELETE FROM pg_temp.videos');
    await client.query("UPDATE pg_temp.live_streams SET thumbnail_url='https://r2.example.test/live-stream-thumbnails/live/source.webp'");
    failCopy = true;
    await assert.rejects(live('recording', 1), { status: 500 });
    assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_temp.videos')).rows[0].n, 0);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_temp.video_indexing_jobs')).rows[0].n, 0);
    failCopy = false;
    failOverview = true;
    await assert.rejects(live('recording', 1), { status: 500 });
    assert.equal(storageCalls.at(-1).constructor.name, 'DeleteObjectCommand');
    assert.equal(storageCalls.at(-1).input.Key, storageCalls.at(-2).input.Key);
    failOverview = false;
    await live('recording', 1);
    const first = (await state()).video;
    await live('recording', 2, { active_asset_id: 'asset-2' });
    const all = (await client.query('SELECT thumbnail_url FROM pg_temp.videos')).rows;
    assert.equal(all.length, 2);
    assert.equal(new Set(all.map(v => v.thumbnail_url)).size, 2);
    assert.ok(all.some(v => v.thumbnail_url === first.thumbnail_url));
  });

  await t.test('an asset event can create and schedule the recording before any live event', async () => {
    await reset();
    await client.query('DELETE FROM pg_temp.videos');
    await asset('ready', 2);
    assert.equal((await state()).video.thumbnail_url, null);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_temp.video_indexing_jobs')).rows[0].n, 1);
  });

  await t.test('overview scheduling failure rolls back the new video and webhook retry schedules it', async () => {
    await reset();
    await client.query('DELETE FROM pg_temp.videos');
    failOverview = true;
    await assert.rejects(live('recording', 1), { status: 500 });
    assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_temp.videos')).rows[0].n, 0);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_temp.video_indexing_jobs')).rows[0].n, 0);
    failOverview = false;
    await live('recording', 1);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_temp.videos')).rows[0].n, 1);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_temp.video_indexing_jobs')).rows[0].n, 1);
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
    assert.equal((await state()).live.status, 'disconnected');
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
    const publishedAt = (await state()).video.published_at;
    assert.ok(publishedAt);
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
    assert.equal(current.video.published_at, publishedAt);
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
    assert.ok(current.video.published_at);
    assert.equal(new Date(current.live.started_at).toISOString(), stamp(3));
  });

  await t.test('late completion after a newer ready event still finalizes the recording', async () => {
    await reset();
    await asset('ready', 21);
    await asset('live_stream_completed', 20);
    assert.equal((await state()).video.mux_status, 'ready');
    assert.ok((await state()).video.published_at);
    assert.equal((await state()).live.status, 'ended');
  });

  await t.test('completed but still preparing waits for a later ready asset', async () => {
    await reset();
    await asset('live_stream_completed', 20, { status: 'preparing', playback_ids: [] });
    assert.equal((await state()).video.mux_status, 'preparing');
    assert.equal((await state()).video.published_at, null);
    await asset('ready', 21);
    assert.equal((await state()).video.mux_status, 'ready');
    assert.ok((await state()).video.published_at);
  });

  await t.test('publication preserves scheduled dates and does not undo manual unpublishing on retries', async () => {
    await reset();
    await client.query("UPDATE pg_temp.videos SET published_at='2999-01-01', visibility='private'");
    await asset('live_stream_completed', 20);
    assert.equal(new Date((await state()).video.published_at).toISOString(), '2999-01-01T00:00:00.000Z');
    assert.equal((await state()).video.visibility, 'private');
    await client.query('UPDATE pg_temp.videos SET published_at=NULL');
    await asset('live_stream_completed', 20);
    await asset('updated', 21);
    assert.equal((await state()).video.published_at, null);
  });

  await t.test('publication backfill only changes completed ready recordings without a date and is idempotent', async () => {
    await reset();
    const parentId = (await state()).live.id;
    const fixtures = [
      [parentId, 'ready', stamp(20), null],
      [parentId, 'preparing', stamp(20), null],
      [parentId, 'ready', null, null],
      [parentId, 'errored', stamp(20), null],
      [parentId, 'deleted', stamp(20), null],
      [null, 'ready', stamp(20), null],
      [parentId, 'ready', stamp(20), '2999-01-01T00:00:00.000Z'],
      [parentId, 'ready', stamp(20), stamp(25)],
    ];
    const ids = [];
    for (const fixture of fixtures) {
      const id = crypto.randomUUID(); ids.push(id);
      await client.query(`INSERT INTO pg_temp.videos
        (id,live_stream_id,mux_status,mux_recording_completed_at,published_at,visibility)
        VALUES ($1,$2,$3,$4,$5,'public')`, [id, ...fixture]);
    }
    const sql = (await readFile(new URL('../src/database/migrations/1790683200000_publish-completed-live-recordings.sql', import.meta.url), 'utf8'))
      .split('-- Down Migration')[0].replaceAll('public.', 'pg_temp.');
    await client.query(sql);
    const load = async () => (await client.query('SELECT id,published_at,visibility FROM pg_temp.videos WHERE id=ANY($1::uuid[]) ORDER BY id', [ids])).rows;
    const rows = await load();
    assert.ok(rows.find(row => row.id === ids[0]).published_at);
    for (let i = 1; i < fixtures.length; i++) {
      const row = rows.find(row => row.id === ids[i]);
      assert.equal(row.published_at?.toISOString() ?? null, fixtures[i][3]);
      assert.equal(row.visibility, 'public');
    }
    await client.query(sql);
    assert.deepEqual(await load(), rows);
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

  await t.test('early sessions retain separate recordings and late completion cannot end a newer session', async () => {
    await reset({scheduled_at:stamp(30)});
    await live('connected',1);
    await live('active',2);
    await live('disconnected',4);
    assert.equal((await state()).live.status,'disconnected');
    await live('idle',10);
    assert.equal((await state()).live.status,'scheduled');
    assert.equal((await state()).live.mux_status,'idle');
    assert.equal((await state()).live.ended_at,null);
    await live('connected',15,{active_asset_id:'asset-2'});
    await live('active',16,{active_asset_id:'asset-2'});
    await asset('live_stream_completed',11);
    await asset('live_stream_completed',11);
    assert.equal((await state()).live.status,'live');
    await live('disconnected',17,{active_asset_id:'asset-2'});
    await asset('live_stream_completed',20,{id:'asset-2'});
    await live('idle',21,{active_asset_id:'asset-2'});
    assert.equal((await state()).live.status,'scheduled');
    assert.deepEqual(disableCalls,[]);
    await live('connected',30,{active_asset_id:'asset-3'});
    await live('active',31,{active_asset_id:'asset-3'});
    await asset('live_stream_completed',32,{id:'asset-2'});
    await asset('deleted',33,{id:'asset-2',live_stream_id:undefined});
    assert.equal((await state()).live.status,'live');
    await live('disconnected',40,{active_asset_id:'asset-3'});
    await live('idle',50,{active_asset_id:'asset-3'});
    await asset('live_stream_completed',51,{id:'asset-3'});
    const recordings=(await client.query('SELECT * FROM pg_temp.videos ORDER BY created_at,id')).rows;
    assert.equal(recordings.length,3);
    assert.deepEqual(recordings.map(v=>v.mux_asset_id),['asset-1','asset-2','asset-3']);
    assert.deepEqual(recordings.map(v=>v.mux_status),['ready','deleted','ready']);
    assert.equal(recordings[0].id,videoId);
    assert.equal(recordings[0].like_count,1);
    assert.equal(recordings[1].uploaded_by,ownerId);
    assert.ok(recordings[1].published_at);
    assert.equal((await state()).live.status,'ended');
    assert.deepEqual(disableCalls,['live-1']);
  });

  await t.test('early completion delivered first creates a recording but leaves the stream enabled', async () => {
    await reset({scheduled_at:stamp(30)});
    await asset('live_stream_completed',10);
    await live('active',2);
    await live('idle',11);
    assert.equal((await state()).live.status,'scheduled');
    assert.equal((await state()).live.started_at,null);
    assert.equal((await state()).live.mux_status,'idle');
    assert.equal((await state()).video.mux_status,'ready');
    assert.deepEqual(disableCalls,[]);
  });

  await t.test('late completion after an early idle cannot end the scheduled event', async () => {
    await reset({scheduled_at:stamp(30)});
    await live('active',2);
    await live('disconnected',4);
    await live('idle',10);
    await asset('live_stream_completed',31);
    assert.equal((await state()).live.status,'scheduled');
    assert.equal((await state()).video.mux_status,'ready');
    assert.deepEqual(disableCalls,[]);
  });

  await t.test('expiry at or after scheduled time ends the event; reconnect within the window keeps one recording', async () => {
    for(const finish of [30,31]) {
      await reset({scheduled_at:stamp(30)});
      await live('active',2);
      await live('disconnected',4);
      await live('connected',5,{status:'active'});
      assert.equal((await state()).live.status,'live');
      await live('disconnected',20);
      await live('idle',finish);
      assert.equal((await state()).live.status,'ended');
      assert.deepEqual(disableCalls,['live-1']);
      assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_temp.videos')).rows[0].n,1);
    }
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
    assert.equal((await state()).video.published_at, null);
    assert.equal((await state()).live.status, 'ended');
  });

  await t.test('a new asset has its own recording and cannot replace the original or reopen an ended stream', async () => {
    await reset();
    await asset('live_stream_completed', 20);
    await live('active', 25, { active_asset_id: 'asset-2' });
    await asset('ready', 26, { id: 'asset-2' });
    await asset('live_stream_completed', 30, { id: 'asset-2' });
    const current = await state();
    assert.equal(current.video.mux_asset_id, 'asset-1');
    assert.equal(new Date(current.live.completed_at).toISOString(), stamp(20));
    assert.equal(current.live.status, 'ended');
    assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_temp.videos')).rows[0].n, 2);
  });

  await t.test('completion of a new recording can arrive before its connection events', async () => {
    await reset({scheduled_at:stamp(30)});
    await asset('live_stream_completed',10,{created_at:String(Date.parse(stamp(1))/1000)});
    await asset('live_stream_completed',50,{id:'asset-2',created_at:String(Date.parse(stamp(35))/1000)});
    assert.equal((await state()).live.status,'ended');
    assert.deepEqual(disableCalls,['live-1']);
    await live('connected',35,{active_asset_id:'asset-2'});
    await live('active',36,{active_asset_id:'asset-2'});
    await asset('ready',12); // old recording's delayed readiness
    assert.equal((await state()).live.status,'ended');
    const second=(await client.query("SELECT * FROM pg_temp.videos WHERE mux_asset_id='asset-2'")).rows[0];
    assert.equal(second.mux_status,'ready');
    assert.equal(new Date(second.mux_recording_started_at).toISOString(),stamp(35));
  });

  await t.test('a recording from old Mux asset settings gets a playback ID matching its inherited policy', async () => {
    await reset();
    await asset('live_stream_completed', 20, { playback_ids: [{ id: 'public-id', policy: 'public' }] });
    assert.equal((await state()).video.mux_playback_id, 'replacement-recording-playback');
    assert.equal((await state()).video.mux_status, 'ready');
    assert.deepEqual(playbackCalls, [['retrieve', 'asset-1'], ['create', 'asset-1', 'signed'], ['delete', 'asset-1', 'public-id']]);
    await asset('ready', 21, { playback_ids: [{ id: 'public-id', policy: 'public' }] });
    assert.equal((await state()).video.mux_playback_id, 'replacement-recording-playback');
    assert.equal(playbackCalls.length, 3);
  });

  await t.test('recording policy retries reuse the replacement after remote cleanup failure', async () => {
    await reset();
    failPlaybackDelete = true;
    const payload = { playback_ids: [{ id: 'public-id', policy: 'public' }] };
    await assert.rejects(asset('live_stream_completed', 20, payload), { status: 500 });
    assert.equal((await state()).video.mux_playback_id, null);
    failPlaybackDelete = false;
    await asset('live_stream_completed', 20, payload);
    assert.equal((await state()).video.mux_status, 'ready');
    assert.equal(playbackCalls.filter(([name]) => name === 'create').length, 1);
    assert.deepEqual(assetPlaybacks, [{ id: 'replacement-recording-playback', policy: 'signed' }]);
  });

  await t.test('a delayed live snapshot cannot restore a revoked ID with the same policy', async () => {
    await reset();
    await live('updated', 1, { playback_ids: [{ id: 'revoked-signed-id', policy: 'signed' }] });
    assert.equal((await state()).live.mux_live_playback_id, 'live-playback');
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


});
