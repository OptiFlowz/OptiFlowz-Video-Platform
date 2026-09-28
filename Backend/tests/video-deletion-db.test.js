import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { mock, test } from 'node:test';
import pg from 'pg';

test('deletion removes video, live stream and dependents in PostgreSQL', {
  skip: !process.env.TEST_DATABASE_URL,
}, async t => {
  const client = new pg.Client({
    connectionString: process.env.TEST_DATABASE_URL,
    connectionTimeoutMillis: 5000, statement_timeout: 10000,
  });
  await client.connect();
  t.after(() => client.end());
  // Application data is never mutated; all SQL is redirected to connection-local tables.
  await client.query('CREATE TEMP TABLE videos (LIKE public.videos INCLUDING DEFAULTS INCLUDING CONSTRAINTS)');
  await client.query('ALTER TABLE pg_temp.videos ADD PRIMARY KEY (id)');
  const migration = await readFile(new URL('../src/database/migrations/1790553600000_add-live-streams.sql', import.meta.url), 'utf8');
  await client.query(migration.split('-- Down Migration')[0].replaceAll('public.', 'pg_temp.'));
  await client.query(`CREATE TEMP TABLE video_reactions (
    video_id uuid REFERENCES pg_temp.videos(id) ON DELETE CASCADE, reaction text
  )`);
  mock.module(new URL('../src/database/index.js', import.meta.url).href, {
    namedExports: { writePool: {
      query: (sql, values) => client.query(sql.replaceAll('public.', 'pg_temp.'), values),
    } },
  });
  const calls = [];
  let failureStatus = 404;
  function remoteDelete(id) {
    calls.push(id);
    throw Object.assign(new Error('Mock Mux response'), { status: failureStatus });
  }
  mock.module('@mux/mux-node', {
    defaultExport: class {
      video = {
        liveStreams: { retrieve: remoteDelete, disable: remoteDelete, delete: remoteDelete },
        assets: {
          list: () => ({ asResponse: async () => Response.json({ data: [], next_cursor: null }) }),
          delete: remoteDelete,
        },
      };
    },
  });
  const { deleteLiveStreamInternal: deleteLive } = await import('../src/modules/live-streams/handlers/deleteLiveStream.js');
  const { deleteVideoInternal: deleteVideo } = await import('../src/modules/videos/video-moderation/handlers/deleteVideo.js');
  const ownerId = randomUUID();
  const { rows: [video] } = await client.query(
    `INSERT INTO pg_temp.videos (uploaded_by, title, mux_asset_id)
     VALUES ($1, 'Recording', 'missing-recording') RETURNING id`, [ownerId],
  );
  const { rows: [live] } = await client.query(
    `INSERT INTO pg_temp.live_streams (video_id, mux_live_stream_id, mux_live_playback_id)
     VALUES ($1, 'missing-stream', 'playback') RETURNING id`, [video.id],
  );
  await client.query("INSERT INTO pg_temp.video_reactions VALUES ($1, 'like')", [video.id]);

  await assert.rejects(deleteLive(live.id, randomUUID()), { status: 404 });
  assert.deepEqual(calls, []);
  failureStatus = 503;
  await assert.rejects(deleteLive(live.id, ownerId), { status: 502 });
  assert.equal((await client.query('SELECT count(*)::int AS count FROM pg_temp.videos')).rows[0].count, 1);
  assert.equal((await client.query('SELECT count(*)::int AS count FROM pg_temp.video_reactions')).rows[0].count, 1);
  failureStatus = 404;
  await deleteLive(live.id, ownerId);
  for (const table of ['videos', 'live_streams', 'video_reactions']) {
    assert.equal((await client.query(`SELECT count(*)::int AS count FROM pg_temp.${table}`)).rows[0].count, 0);
  }

  const { rows: [vod] } = await client.query(
    "INSERT INTO pg_temp.videos (mux_asset_id) VALUES ('missing-vod') RETURNING id",
  );
  await deleteVideo({ params: { videoId: vod.id } });
  assert.equal((await client.query('SELECT count(*)::int AS count FROM pg_temp.videos')).rows[0].count, 0);
});
