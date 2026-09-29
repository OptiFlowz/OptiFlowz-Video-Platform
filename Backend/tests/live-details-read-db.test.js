import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { prepareLiveSchema } from './helpers/live-stream-schema.js';

test('livestream details and current recording against PostgreSQL fixtures', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  await client.connect(); t.after(() => client.end());
  await prepareLiveSchema(client);
  await client.query(`ALTER TABLE pg_temp.users ADD COLUMN full_name text, ADD COLUMN image_url text,
    ADD COLUMN status text DEFAULT 'active', ADD COLUMN authz_version integer DEFAULT 1;
    CREATE TEMP TABLE watch_progress (video_id uuid, user_id uuid, progress_seconds integer, percentage_watched numeric, PRIMARY KEY(video_id,user_id));
    CREATE TEMP TABLE video_reactions (video_id uuid, user_id uuid, reaction integer, PRIMARY KEY(video_id,user_id));
    CREATE TEMP TABLE video_comments (id uuid PRIMARY KEY, video_id uuid, parent_id uuid, is_deleted boolean DEFAULT false);`);
  const id = '12345678-1234-4234-8234-123456789012';
  const owner = '12345678-1234-4234-8234-123456789abc';
  const viewer = '12345678-1234-4234-8234-123456789def';
  await client.query("INSERT INTO pg_temp.users(id,full_name,image_url) VALUES ($1,'Creator','https://example.com/avatar.webp'),($2,'Viewer',NULL)", [owner, viewer]);
  let queries = 0, videoId;
  mock.module(new URL('../src/database/index.js', import.meta.url).href, { namedExports: { writePool: {
    async query(sql, params) { queries++; return client.query(sql.replaceAll('public.', 'pg_temp.'), params); },
  } } });
  const { getLiveDetailsInternal: details } = await import('../src/modules/live-streams/handlers/getLiveDetails.js');
  const { default: router } = await import('../src/modules/live-streams/live-streams.routes.js');
  async function reset() {
    await client.query('TRUNCATE pg_temp.live_streams, pg_temp.videos, pg_temp.watch_progress, pg_temp.video_reactions, pg_temp.video_comments');
    await client.query(`INSERT INTO pg_temp.live_streams(id,user_id,title,description,status,mux_status,dvr_enabled,
      playback_policy,mux_live_stream_id,mux_live_playback_id,mux_active_asset_id,scheduled_at,started_at,connected_at)
      VALUES ($1,$2,'Live title','Live description','live','active',true,'signed','mux-live','live-playback','current-asset',now(),now(),now())`, [id, owner]);
    await client.query(`INSERT INTO pg_temp.videos(live_stream_id,uploaded_by,mux_asset_id,mux_status,mux_recording_completed_at)
      VALUES ($1,$2,'old-asset','ready',now())`, [id, owner]);
    const result = await client.query(`INSERT INTO pg_temp.videos(live_stream_id,uploaded_by,title,description,mux_asset_id,mux_status,
      playback_policy,published_at,mux_recording_started_at,view_count,like_count,dislike_count)
      VALUES ($1,$2,'Recording title','Recording description','current-asset','preparing','signed',NULL,now(),12,3,1) RETURNING id`, [id, owner]);
    videoId = result.rows[0].id;
    // A newer row is not necessarily the current recording.
    await client.query(`INSERT INTO pg_temp.videos(live_stream_id,uploaded_by,mux_asset_id,mux_status,created_at)
      VALUES ($1,$2,'unrelated-asset','ready',now()+interval '1 hour')`, [id, owner]);
    await client.query('INSERT INTO pg_temp.watch_progress VALUES ($1,$2,25,10.5),($1,$3,99,90)', [videoId, viewer, owner]);
    await client.query('INSERT INTO pg_temp.video_reactions VALUES ($1,$2,1),($1,$3,-1)', [videoId, viewer, owner]);
    await client.query(`INSERT INTO pg_temp.video_comments(id,video_id,parent_id,is_deleted) VALUES
      ($2,$1,NULL,false),($3,$1,NULL,true),
      (uuid_generate_v4(),$1,$2,false),(uuid_generate_v4(),$1,$3,false),
      (uuid_generate_v4(),$1,NULL,true)`, [videoId, owner, viewer]);
    queries = 0;
  }

  await t.test('returns metadata and the exact unfinished recording including preparing, unpublished content', async () => {
    await reset();
    const { live_stream: live } = await details(id, viewer);
    assert.equal(live.id, id); assert.equal(live.title, 'Live title'); assert.equal(live.description, 'Live description');
    assert.equal(live.status, 'live'); assert.equal(live.mux_status, 'active');
    assert.equal(live.dvr_enabled, true); assert.equal(live.playback_policy, 'signed'); assert.equal(live.visibility, 'public');
    assert.equal(live.thumbnail_url, null); assert.ok(live.scheduled_at); assert.ok(live.started_at); assert.ok(live.connected_at);
    assert.equal(live.ended_at, null); assert.equal(live.uploader_id, owner); assert.equal(live.uploader_name, 'Creator');
    assert.equal(live.uploader_image, 'https://example.com/avatar.webp');
    assert.equal(live.video_id, videoId);
    const recording = live.current_recording;
    assert.equal(recording.id, videoId); assert.equal(recording.livestream_id, id);
    assert.equal(recording.title, 'Recording title'); assert.equal(recording.description, 'Recording description');
    assert.equal(recording.mux_status, 'preparing'); assert.equal(recording.published_at, null);
    assert.equal(recording.thumbnail_url, null); assert.ok(recording.recording_started_at); assert.equal(recording.recording_completed_at, null);
    assert.equal(recording.view_count, 12); assert.equal(recording.like_count, 3); assert.equal(recording.dislike_count, 1);
    assert.equal(recording.comment_count, 2); assert.equal(recording.user_reaction, 1);
    assert.equal(recording.progress_seconds, 25); assert.equal(recording.percentage_watched, 10.5);
    assert.equal(queries, 1);
    const ownRecording = (await details(id, owner)).live_stream.current_recording;
    assert.equal(ownRecording.user_reaction, -1); assert.equal(ownRecording.progress_seconds, 99);
  });

  await t.test('enforces authentication, ID validation and current visibility', async () => {
    await reset();
    await assert.rejects(details(id), { status: 401 });
    await assert.rejects(details('invalid', viewer), { status: 400 });
    assert.equal(queries, 0);
    await assert.rejects(details(viewer, viewer), { status: 404 });
    await client.query("UPDATE pg_temp.live_streams SET visibility='private' WHERE id=$1", [id]);
    await assert.rejects(details(id, viewer), { status: 404 });
    assert.equal((await details(id, owner)).live_stream.id, id);
    await client.query("UPDATE pg_temp.live_streams SET visibility='unlisted' WHERE id=$1", [id]);
    assert.equal((await details(id, viewer)).live_stream.id, id);
  });

  await t.test('returns details across lifecycle states, but a current recording only for live or disconnected streams', async () => {
    await reset();
    for (const status of ['disconnected', 'scheduled', 'ended', 'cancelled', 'live']) {
      await client.query('UPDATE pg_temp.live_streams SET status=$2 WHERE id=$1', [id, status]);
      const live = (await details(id, viewer)).live_stream;
      assert.equal(live.status, status);
      if (['live', 'disconnected'].includes(status)) assert.equal(live.current_recording.id, videoId);
      else { assert.equal(live.current_recording, null); assert.equal(live.video_id, null); }
    }
  });

  await t.test('never attaches a previous, completed, deleted or different-session recording', async () => {
    await reset();
    for (const asset of [null, 'missing-asset', 'old-asset']) {
      await client.query('UPDATE pg_temp.live_streams SET mux_active_asset_id=$2 WHERE id=$1', [id, asset]);
      const live = (await details(id, viewer)).live_stream;
      assert.equal(live.current_recording, null); assert.equal(live.video_id, null);
    }
    await client.query("UPDATE pg_temp.live_streams SET mux_active_asset_id='current-asset' WHERE id=$1", [id]);
    await client.query('UPDATE pg_temp.videos SET mux_recording_completed_at=now() WHERE id=$1', [videoId]);
    assert.equal((await details(id, viewer)).live_stream.current_recording, null);
    await client.query("UPDATE pg_temp.videos SET mux_recording_completed_at=NULL,mux_status='deleted' WHERE id=$1", [videoId]);
    assert.equal((await details(id, viewer)).live_stream.current_recording, null);
    for (const status of ['ready', 'errored']) {
      await client.query('UPDATE pg_temp.videos SET mux_status=$2 WHERE id=$1', [videoId, status]);
      assert.equal((await details(id, viewer)).live_stream.current_recording.mux_status, status);
    }
  });

  await t.test('GET route returns authenticated non-cacheable details without Mux resource IDs or credentials', async () => {
    await reset();
    const previous = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'live-details-test';
    t.after(() => { if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous; });
    const app = express(); app.use('/api/live-streams', router);
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const url = `http://127.0.0.1:${server.address().port}/api/live-streams/${id}`;
    const headers = user => ({ Authorization: `Bearer ${jwt.sign({ sub: user, purpose: 'access' }, process.env.JWT_SECRET)}` });
    assert.equal((await fetch(url)).status, 401);
    const response = await fetch(url, { headers: headers(viewer) });
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
    const body = await response.json();
    assert.equal(body.success, true); assert.equal(body.live_stream.video_id, videoId);
    assert.equal(body.live_stream.current_recording.id, videoId);
    for (const object of [body.live_stream, body.live_stream.current_recording]) {
      for (const key of ['stream_key', 'mux_live_stream_id', 'mux_active_asset_id', 'mux_asset_id', 'mux_playback_id', 'mux_live_playback_id']) {
        assert.equal(Object.hasOwn(object, key), false);
      }
    }
    await client.query("UPDATE pg_temp.live_streams SET visibility='private' WHERE id=$1", [id]);
    assert.equal((await fetch(url, { headers: headers(viewer) })).status, 404);
    assert.equal((await fetch(url, { headers: headers(owner) })).status, 200);
  });
});
