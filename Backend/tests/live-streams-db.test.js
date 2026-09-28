import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { mock, test } from 'node:test';
import pg from 'pg';

test('live stream migration and creation against PostgreSQL temporary tables', {
  skip: !process.env.TEST_DATABASE_URL,
}, async t => {
  const client = new pg.Client({
    connectionString: process.env.TEST_DATABASE_URL,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  });
  await client.connect();
  t.after(() => client.end());
  // Copy column defaults and checks only. All writes remain connection-local;
  // no application rows or tables are changed, including by the migration.
  await client.query('CREATE TEMP TABLE videos (LIKE public.videos INCLUDING DEFAULTS INCLUDING CONSTRAINTS)');
  await client.query('ALTER TABLE pg_temp.videos ADD PRIMARY KEY (id)');
  const migration = await readFile(new URL('../src/database/migrations/1790553600000_add-live-streams.sql', import.meta.url), 'utf8');
  const [up, down] = migration.replaceAll('public.', 'pg_temp.').split('-- Down Migration');
  await client.query(up);

  let failLiveInsert = false;
  let sequence = 0;
  const deleted = [];
  mock.module(new URL('../src/database/index.js', import.meta.url).href, {
    namedExports: { writePool: {
      async connect() {
        return {
          async query(sql, values) {
            if (failLiveInsert && sql.includes('INSERT INTO public.live_streams')) {
              throw new Error('Live stream insert failed');
            }
            return client.query(sql.replaceAll('public.', 'pg_temp.'), values);
          },
          release() {},
        };
      },
    } },
  });
  mock.module('@mux/mux-node', {
    defaultExport: class {
      video = { liveStreams: {
        async create(params) {
          return {
            id: `test-mux-${++sequence}`, stream_key: 'test-key',
            playback_ids: [{ id: 'test-playback', policy: params.playback_policies[0] }],
          };
        },
        async delete(id) { deleted.push(id); },
      } };
    },
  });
  const { createLiveStreamInternal: create } = await import('../src/modules/live-streams/handlers/createLiveStream.js');
  const result = await create({
    title: 'Live event', description: 'Shared metadata', visibility: 'unlisted',
    playback_policy: 'public', dvr_enabled: true, scheduled_at: '2030-10-01T18:00:00+02:00',
  }, randomUUID());
  assert.equal(result.live_stream.video_id, result.video.id);
  assert.equal(result.video.visibility, 'unlisted');
  assert.equal(result.video.playback_policy, 'public');
  assert.equal(result.video.published_at, null);
  assert.equal(result.video.mux_status, 'preparing');
  assert.equal(result.video.mux_asset_id, null);
  assert.equal(result.live_stream.status, 'scheduled');
  assert.equal(result.live_stream.mux_status, 'idle');
  for (const column of ['user_id', 'title', 'description', 'thumbnail_url', 'visibility', 'playback_policy', 'mux_asset_id', 'mux_asset_playback_id', 'replay_video_id']) {
    assert.ok(!(column in result.live_stream), `${column} must not be duplicated`);
  }
  const insert = `INSERT INTO pg_temp.live_streams (video_id, mux_live_stream_id, mux_live_playback_id) VALUES ($1, 'other', 'other')`;
  await assert.rejects(client.query(insert, [result.video.id]), { code: '23505' });
  await assert.rejects(client.query(insert, [randomUUID()]), { code: '23503' });
  await assert.rejects(client.query(insert, [null]), { code: '23502' });

  failLiveInsert = true;
  await assert.rejects(create({ title: 'Rolled back' }, randomUUID()), /Live stream insert failed/);
  assert.deepEqual(deleted, ['test-mux-2']);
  assert.equal((await client.query('SELECT count(*)::int AS count FROM pg_temp.videos')).rows[0].count, 1);
  assert.equal((await client.query('SELECT count(*)::int AS count FROM pg_temp.live_streams')).rows[0].count, 1);

  await client.query('DELETE FROM pg_temp.videos WHERE id = $1', [result.video.id]);
  assert.equal((await client.query('SELECT count(*)::int AS count FROM pg_temp.live_streams')).rows[0].count, 0);
  await client.query("INSERT INTO pg_temp.videos (title, visibility) VALUES ('Unlisted before downgrade', 'unlisted')");
  await client.query(down);
  assert.equal((await client.query("SELECT to_regclass('pg_temp.live_streams') AS relation")).rows[0].relation, null);
  assert.equal((await client.query('SELECT count(*)::int AS count FROM pg_temp.videos')).rows[0].count, 1);
  await assert.rejects(client.query("INSERT INTO pg_temp.videos (visibility) VALUES ('unlisted')"), { code: '23514' });
});
