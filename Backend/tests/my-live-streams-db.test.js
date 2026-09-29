import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { prepareLiveSchema } from './helpers/live-stream-schema.js';
import { prepareLivePermissions } from './helpers/live-permissions-schema.js';

test('my livestream listing and HTTP route against PostgreSQL temporary tables', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  await client.connect();
  t.after(() => client.end());
  await prepareLiveSchema(client);
  await client.query("ALTER TABLE pg_temp.users ADD COLUMN status text DEFAULT 'active', ADD COLUMN authz_version integer DEFAULT 1");
  const uuid = n => `12345678-1234-4234-8234-${String(n).padStart(12, '0')}`;
  const owner = uuid(100), other = uuid(101), emptyOwner = uuid(102);
  await client.query('INSERT INTO pg_temp.users(id) VALUES ($1),($2),($3)', [owner, other, emptyOwner]);
  await prepareLivePermissions(client, [owner, other, emptyOwner]);
  for (const [index, status] of ['scheduled', 'live', 'disconnected', 'ended', 'cancelled', 'scheduled'].entries()) {
    const n = index + 1;
    await client.query(`INSERT INTO pg_temp.live_streams
      (id,user_id,title,description,thumbnail_url,status,visibility,playback_policy,dvr_enabled,
       scheduled_at,created_at,mux_live_stream_id,mux_live_playback_id)
      VALUES ($1,$2,$3,'Description','https://example.test/thumb.webp',$4,'private','signed',true,$5,$6,$7,$8)`,
    [uuid(n), n === 6 ? other : owner, `Title ${7 - n}`, status,
      n <= 2 ? `2026-10-${12 - n}T10:00:00Z` : null,
      `2026-09-0${Math.max(1, n - 1)}T10:00:00Z`, `mux-${n}`, `playback-${n}`]);
  }
  let queries = 0;
  mock.module(new URL('../src/database/index.js', import.meta.url).href, { namedExports: { writePool: {
    async query(sql, params) { queries++; return client.query(sql.replaceAll('public.', 'pg_temp.'), params); },
  } } });
  mock.module('@mux/mux-node', { defaultExport: class {} });
  const { getMyLiveStreamsInternal: list } = await import('../src/modules/live-streams/handlers/getMyLiveStreams.js');
  const { default: router } = await import('../src/modules/live-streams/live-streams.routes.js');
  const ids = result => result.live_streams.map(stream => stream.id);

  await t.test('defaults include every lifecycle state for the owner, with explicit listing fields', async () => {
    const result = await list({ query: {} }, owner);
    assert.deepEqual(ids(result), [5, 4, 3, 2, 1].map(uuid));
    assert.equal(result.total, 5);
    assert.equal(result.page, 1);
    assert.equal(result.limit, 20);
    assert.equal(result.total_pages, 1);
    assert.equal(result.sort_by, 'created_at');
    assert.equal(result.sort_dir, 'desc');
    for (const stream of result.live_streams) {
      assert.equal(stream.user_id, owner);
      assert.equal(stream.description, 'Description');
      assert.equal(stream.visibility, 'private');
      assert.equal(stream.dvr_enabled, true);
      assert.equal(stream.thumbnail_url, 'https://example.test/thumb.webp');
      for (const field of ['stream_key', 'mux_live_stream_id', 'mux_live_playback_id', 'mux_deleted_asset_ids', 'mux_event_at']) {
        assert.equal(Object.hasOwn(stream, field), false);
      }
    }
  });

  await t.test('pagination keeps owner totals and stable ordering across tied dates', async () => {
    const seen = [];
    for (let page = 1; page <= 3; page++) {
      const result = await list({ query: { page: String(page), limit: '2' } }, owner);
      assert.equal(result.total, 5);
      assert.equal(result.total_pages, 3);
      seen.push(...ids(result));
    }
    assert.deepEqual(seen, [5, 4, 3, 2, 1].map(uuid));
    const beyond = await list({ query: { page: '4', limit: '2' } }, owner);
    assert.deepEqual(beyond.live_streams, []);
    assert.equal(beyond.total, 5);
    const empty = await list({}, emptyOwner);
    assert.equal(empty.total, 0);
    assert.equal(empty.total_pages, 0);
    assert.deepEqual(empty.live_streams, []);
  });

  await t.test('sorting supports new/old, whitelisted columns, directions and null dates last', async () => {
    assert.deepEqual(ids(await list({ query: { sort: 'old' } }, owner)), [1, 2, 3, 4, 5].map(uuid));
    assert.deepEqual(ids(await list({ query: { sort_by: 'title', sort_dir: 'asc' } }, owner)), [5, 4, 3, 2, 1].map(uuid));
    assert.deepEqual(ids(await list({ query: { sort_by: 'scheduled_at', sort_dir: 'asc' } }, owner)), [2, 1, 3, 4, 5].map(uuid));
    assert.deepEqual(ids(await list({ query: { sort_by: 'scheduled_at', sort_dir: 'desc' } }, owner)), [1, 2, 5, 4, 3].map(uuid));
    assert.equal((await list({ query: { sort: 'old', sort_dir: 'desc' } }, owner)).sort_dir, 'desc');
    for (const sort_by of ['started_at', 'updated_at', 'status', 'visibility']) {
      assert.equal((await list({ query: { sort_by } }, owner)).total, 5);
    }
  });

  await t.test('invalid sorting and pagination fail before querying the database', async () => {
    queries = 0;
    await assert.rejects(list({}), { status: 401 });
    for (const query of [
      { page: 'abc' }, { page: '0' }, { page: '1.5' }, { limit: '0' }, { limit: '101' },
      { sort_by: 'created_at; DROP TABLE live_streams' }, { sort_dir: 'sideways' },
      { sort: 'unknown' }, { page: String(Number.MAX_SAFE_INTEGER), limit: '100' },
    ]) await assert.rejects(list({ query }, owner), { status: 400 });
    assert.equal(queries, 0);
  });

  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'my-live-streams-test';
  t.after(() => { if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret; });
  const app = express();
  app.use('/api/live-streams', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/live-streams/my/lives`;
  const headers = user => ({ Authorization: `Bearer ${jwt.sign({ sub: user, purpose: 'access' }, process.env.JWT_SECRET)}` });
  await t.test('HTTP route requires authentication and ignores caller-supplied user IDs', async () => {
    assert.equal((await fetch(url)).status, 401);
    const response = await fetch(`${url}?user_id=${other}&page=2&limit=2`, { headers: headers(owner) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    const body = await response.json();
    assert.equal(body.success, true);
    assert.equal(body.total, 5);
    assert.deepEqual(ids(body), [3, 2].map(uuid));
    const otherResponse = await fetch(url, { headers: headers(other) });
    assert.deepEqual(ids(await otherResponse.json()), [uuid(6)]);
    assert.equal((await fetch(`${url}?sort_by=invalid`, { headers: headers(owner) })).status, 400);
  });
});
