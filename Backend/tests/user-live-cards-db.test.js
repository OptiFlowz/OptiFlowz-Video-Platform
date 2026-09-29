import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { prepareLiveSchema } from './helpers/live-stream-schema.js';

test('public mixed livestream cards against PostgreSQL temporary tables', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  await client.connect(); t.after(() => client.end());
  await prepareLiveSchema(client);
  await client.query(`ALTER TABLE pg_temp.users ADD COLUMN full_name text, ADD COLUMN status text DEFAULT 'active', ADD COLUMN authz_version integer DEFAULT 1;
    CREATE TEMP TABLE people(id uuid PRIMARY KEY,name text,image_url text);
    CREATE TEMP TABLE video_chairs(video_id uuid,person_id uuid);
    CREATE TEMP TABLE watch_progress(video_id uuid,user_id uuid,progress_seconds numeric,percentage_watched numeric);`);
  const uuid = n => `12345678-1234-4234-8234-${String(n).padStart(12, '0')}`;
  const owner = uuid(100), viewer = uuid(101), other = uuid(102);
  await client.query("INSERT INTO pg_temp.users(id,full_name) VALUES ($1,'Owner'),($2,'Viewer'),($3,'Other')", [owner, viewer, other]);
  async function stream(n, { status = 'scheduled', visibility = 'public', user = owner, scheduled = null, started = null } = {}) {
    await client.query(`INSERT INTO pg_temp.live_streams(id,user_id,title,description,thumbnail_url,status,visibility,
      scheduled_at,started_at,created_at,mux_live_stream_id,mux_live_playback_id)
      VALUES ($1,$2,$3,'Live description',$4,$5,$6,$7,$8,'2026-08-01',$9,'live-playback')`,
    [uuid(n), user, `Live ${n}`, `https://example.test/live-${n}.webp`, status, visibility, scheduled, started, `mux-live-${n}`]);
  }
  async function recording(n, parent, { status = 'ready', visibility = 'public', published = '2026-01-01', started = '2026-09-01', views = 10, policy = 'public' } = {}) {
    await client.query(`INSERT INTO pg_temp.videos(id,live_stream_id,uploaded_by,title,description,thumbnail_url,
      mux_status,visibility,published_at,mux_recording_started_at,mux_recording_completed_at,view_count,mux_playback_id,playback_policy,duration_seconds)
      VALUES ($1,$2,$3,$4,'Recording description',$5,$6,$7,$8,$9,'2026-09-10',$10,'recording-playback',$11,120)`,
    [uuid(n), uuid(parent), owner, `Recording ${n}`, `https://example.test/video-${n}.webp`, status, visibility, published, started, views, policy]);
  }
  await stream(1, { status: 'ended' });
  await recording(1001, 1);
  await recording(1002, 1, { started: '2026-09-02', views: 40 });
  await stream(3, { scheduled: '2026-09-04' });
  await stream(4, { status: 'live', started: '2026-09-03' });
  for (const [n, visibility] of [[5, 'private'], [6, 'unlisted']]) {
    await stream(n, { visibility }); await recording(1000 + n, n);
  }
  for (const [n, settings] of [
    [7, { visibility: 'private' }], [8, { visibility: 'unlisted' }], [9, { status: 'preparing' }],
    [10, { status: 'deleted' }], [11, { published: '2999-01-01' }], [12, { published: null }],
  ]) { await stream(n); await recording(1000 + n, n, settings); }
  for (const [n, status] of [[13, 'ended'], [14, 'disconnected'], [15, 'cancelled']]) await stream(n, { status });
  await stream(16, { user: other });
  await stream(17, { status: 'ended' });
  await recording(1017, 17, { started: '2026-09-05', views: 5, policy: 'signed' });
  await stream(18, { status: 'live', visibility: 'private' });
  await stream(19, { status: 'live', visibility: 'unlisted' });
  await client.query("INSERT INTO pg_temp.people VALUES ($1,'Speaker','https://example.test/speaker.webp')", [uuid(200)]);
  await client.query('INSERT INTO pg_temp.video_chairs VALUES ($1,$2),($1,$2)', [uuid(1001), uuid(200)]);
  await client.query('INSERT INTO pg_temp.watch_progress VALUES ($1,$2,30,25),($1,$3,90,75)', [uuid(1001), viewer, other]);

  let queries = 0;
  mock.module(new URL('../src/database/index.js', import.meta.url).href, { namedExports: { writePool: {
    async query(sql, params) { queries++; return client.query(sql.replaceAll('public.', 'pg_temp.'), params); },
  } } });
  mock.module('@mux/mux-node', { defaultExport: class {
    jwtSigningKey = 'test-key'; jwtPrivateKey = 'test-private-key';
    jwt = { async signPlaybackId(id, { type }) { return `test-${id}-${type}`; } };
  } });
  const { getUserLiveCardsInternal: list } = await import('../src/modules/live-streams/handlers/getUserLiveCards.js');
  const { default: router } = await import('../src/modules/live-streams/live-streams.routes.js');
  const input = query => ({ params: { userId: owner }, query });
  const ids = result => result.cards.map(card => card.id);

  await t.test('only public published ready recordings and public streams without recordings are returned', async () => {
    const result = await list(input({}));
    assert.deepEqual(ids(result), [1017, 3, 4, 1002, 1001].map(uuid));
    assert.equal(result.total, 5);
    assert.equal(result.total_pages, 1);
    assert.deepEqual(ids(await list(input({}), owner)), ids(result), 'owner authentication must not expose private/draft content');
    const types = Object.fromEntries(result.cards.map(card => [card.id, card.card_type]));
    assert.equal(types[uuid(1017)], 'recording');
    assert.equal(types[uuid(3)], 'scheduled');
    assert.equal(types[uuid(4)], 'live');
    assert.equal(result.cards.filter(card => card.livestream_id === uuid(1)).length, 2);
  });

  await t.test('recording cards have normal video media, people and optional viewer watch progress', async () => {
    const result = await list(input({}), viewer);
    const recordingCard = result.cards.find(card => card.id === uuid(1001));
    assert.equal(recordingCard.video_id, uuid(1001));
    assert.equal(recordingCard.livestream_id, uuid(1));
    assert.equal(recordingCard.title, 'Recording 1001');
    assert.equal(recordingCard.thumbnail_url, 'https://example.test/video-1001.webp');
    assert.equal(recordingCard.uploader_name, 'Owner');
    assert.equal(recordingCard.uploader_id, owner);
    assert.equal(recordingCard.duration_seconds, 120);
    assert.equal(recordingCard.people.length, 1);
    assert.equal(recordingCard.people[0].name, 'Speaker');
    assert.equal(Number(recordingCard.progress_seconds), 30);
    assert.equal(recordingCard.percentage_watched, 25);
    assert.match(recordingCard.mux_thumbnail_url, /thumbnail.webp/);
    assert.match(recordingCard.preview_url, /animated.webp/);
    const signed = result.cards.find(card => card.id === uuid(1017));
    assert.match(signed.mux_thumbnail_url, /token=test-/);
    assert.ok(signed.media_expires_at);
    const scheduled = result.cards.find(card => card.id === uuid(3));
    assert.equal(scheduled.video_id, null);
    assert.equal(scheduled.thumbnail_url, 'https://example.test/live-3.webp');
    assert.equal(scheduled.streamed_at, null);
    assert.equal(scheduled.view_count, 0);
    assert.equal(scheduled.preview_url, null);
    assert.equal(scheduled.mux_thumbnail_url, null);
    assert.deepEqual(scheduled.people, []);
    for (const card of result.cards) for (const field of ['sort_at', 'stream_key', 'mux_live_stream_id', 'mux_playback_id_pending_deletion']) {
      assert.equal(Object.hasOwn(card, field), false);
    }
  });

  await t.test('sorting and pagination apply to the unified list, with counts even beyond the last page', async () => {
    assert.deepEqual(ids(await list(input({ sort_by: 'views' }))), [1002, 1001, 1017, 3, 4].map(uuid));
    assert.deepEqual(ids(await list(input({ sort_by: 'view_count', sort_dir: 'asc' }))), [4, 3, 1017, 1001, 1002].map(uuid));
    assert.deepEqual(ids(await list(input({ sort_by: 'streamed_at', sort_dir: 'asc' }))), [1001, 1002, 4, 3, 1017].map(uuid));
    const seen = [];
    for (let page = 1; page <= 3; page++) {
      const result = await list(input({ page: String(page), limit: '2' }));
      assert.equal(result.total, 5); assert.equal(result.total_pages, 3); seen.push(...ids(result));
    }
    assert.deepEqual(seen, [1017, 3, 4, 1002, 1001].map(uuid));
    const beyond = await list(input({ page: '4', limit: '2' }));
    assert.equal(beyond.total, 5); assert.deepEqual(beyond.cards, []);
    const empty = await list({ params: { userId: uuid(9999) } });
    assert.equal(empty.total_pages, 0); assert.deepEqual(empty.cards, []);
  });

  await t.test('a public live card does not expose its private recordings', async () => {
    await client.query("UPDATE pg_temp.videos SET visibility='private' WHERE live_stream_id=$1", [uuid(1)]);
    await client.query("UPDATE pg_temp.live_streams SET status='live' WHERE id=$1", [uuid(1)]);
    const cards = (await list(input({}))).cards.filter(card => card.livestream_id === uuid(1));
    assert.equal(cards.length, 1);
    assert.equal(cards[0].card_type, 'live');
    assert.equal(cards[0].video_id, null);
    assert.equal(cards[0].title, 'Live 1');
    await client.query("UPDATE pg_temp.videos SET visibility='public' WHERE live_stream_id=$1", [uuid(1)]);
    await client.query("UPDATE pg_temp.live_streams SET status='ended' WHERE id=$1", [uuid(1)]);
  });

  await t.test('an active stream with preparing recordings stays visible once, with correct pagination', async () => {
    await stream(20, { status: 'live', started: '2026-09-20' });
    await recording(1020, 20, { status: 'preparing', published: null });
    await recording(1021, 20, { status: 'preparing', published: null });
    await client.query('UPDATE pg_temp.videos SET mux_recording_completed_at=NULL WHERE live_stream_id=$1', [uuid(20)]);
    await client.query("UPDATE pg_temp.videos SET mux_asset_id='active-asset' WHERE id=$1", [uuid(1020)]);
    await client.query("UPDATE pg_temp.videos SET mux_asset_id='other-asset' WHERE id=$1", [uuid(1021)]);
    await client.query("UPDATE pg_temp.live_streams SET mux_active_asset_id='active-asset' WHERE id=$1", [uuid(20)]);
    await client.query('INSERT INTO pg_temp.video_chairs VALUES ($1,$2)', [uuid(1020), uuid(200)]);
    await client.query('INSERT INTO pg_temp.watch_progress VALUES ($1,$2,30,25)', [uuid(1020), viewer]);
    try {
      const result = await list(input({ limit: '1' }), viewer);
      assert.equal(result.total, 6);
      assert.equal(result.total_pages, 6);
      assert.equal(result.cards[0].id, uuid(20));
      assert.equal(result.cards[0].card_type, 'live');
      assert.equal(result.cards[0].video_id, uuid(1020));
      assert.deepEqual(result.cards[0].people, []);
      assert.equal(result.cards[0].progress_seconds, null);
      assert.equal(result.cards[0].preview_url, null);
      assert.equal(result.cards[0].thumbnail_url, 'https://example.test/live-20.webp');
      assert.equal((await list(input({}))).cards.filter(card => card.livestream_id === uuid(20)).length, 1);
      // Match Mux's current asset, never an arbitrary/latest video from this stream.
      await client.query("UPDATE pg_temp.live_streams SET mux_active_asset_id='other-asset' WHERE id=$1", [uuid(20)]);
      assert.equal((await list(input({ limit: '1' }))).cards[0].video_id, uuid(1021));
      await client.query("UPDATE pg_temp.live_streams SET mux_active_asset_id='not-created-yet' WHERE id=$1", [uuid(20)]);
      assert.equal((await list(input({ limit: '1' }))).cards[0].video_id, null);
      await client.query("UPDATE pg_temp.live_streams SET mux_active_asset_id='active-asset' WHERE id=$1", [uuid(20)]);
      await client.query('UPDATE pg_temp.videos SET mux_recording_completed_at=now() WHERE id=$1', [uuid(1020)]);
      assert.equal((await list(input({ limit: '1' }))).cards[0].video_id, null);
      await client.query("UPDATE pg_temp.videos SET mux_recording_completed_at=NULL,mux_status='deleted' WHERE id=$1", [uuid(1020)]);
      assert.equal((await list(input({ limit: '1' }))).cards[0].video_id, null);
      await client.query("UPDATE pg_temp.videos SET mux_status='preparing' WHERE id=$1", [uuid(1020)]);
      // After a broadcast ends, preparing/unpublished recordings remain hidden.
      await client.query("UPDATE pg_temp.live_streams SET status='ended' WHERE id=$1", [uuid(20)]);
      assert.equal((await list(input({}))).total, 5);
      await client.query("UPDATE pg_temp.videos SET mux_status='ready', published_at='2026-01-01' WHERE id=$1", [uuid(1020)]);
      const ended = await list(input({}));
      assert.equal(ended.total, 6);
      assert.equal(ended.cards.find(card => card.livestream_id === uuid(20)).card_type, 'recording');
      // An earlier published recording does not replace a new live broadcast card.
      await client.query("UPDATE pg_temp.live_streams SET status='live' WHERE id=$1", [uuid(20)]);
      const restarted = await list(input({}));
      assert.equal(restarted.total, 7);
      assert.deepEqual(restarted.cards.filter(card => card.livestream_id === uuid(20)).map(card => card.card_type).sort(), ['live', 'recording']);
    } finally {
      await client.query('DELETE FROM pg_temp.live_streams WHERE id=$1', [uuid(20)]);
    }
  });

  await t.test('invalid IDs, sort fields and pagination fail before SQL', async () => {
    queries = 0;
    await assert.rejects(list({ params: { userId: 'invalid' } }), { status: 400 });
    for (const query of [{ page: '0' }, { limit: '101' }, { page: 'abc' }, { sort_dir: 'bad' }, { sort_by: 'views;DROP TABLE videos' }]) {
      await assert.rejects(list(input(query)), { status: 400 });
    }
    assert.equal(queries, 0);
  });

  const oldSecret = process.env.JWT_SECRET; process.env.JWT_SECRET = 'public-live-card-test';
  t.after(() => { if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret; });
  const app = express(); app.use('/api/live-streams', router);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  await t.test('public HTTP route works for guests and scopes cards to the path user', async () => {
    const url = `http://127.0.0.1:${server.address().port}/api/live-streams/users/${owner}/cards`;
    const response = await fetch(`${url}?sort_by=views&limit=2&userId=${other}`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.success, true); assert.equal(body.total, 5);
    assert.deepEqual(ids(body), [1002, 1001].map(uuid));
    const authorized = await fetch(url, { headers: { Authorization: `Bearer ${jwt.sign({ sub: viewer, purpose: 'access' }, process.env.JWT_SECRET)}` } });
    assert.equal(authorized.status, 200);
    assert.equal((await authorized.json()).total, 5);
    assert.equal((await fetch(`${url}?limit=0`)).status, 400);
  });
});
