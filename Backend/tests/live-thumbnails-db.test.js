import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import pg from 'pg';
import sharp from 'sharp';

test('live thumbnail propagation against PostgreSQL temporary tables', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  await client.connect();
  t.after(() => client.end());
  await client.query(`CREATE TEMP TABLE live_streams (id uuid PRIMARY KEY, user_id uuid, thumbnail_url text, updated_at timestamptz);
    CREATE TEMP TABLE videos (id uuid PRIMARY KEY, live_stream_id uuid, mux_status text, thumbnail_url text, updated_at timestamptz);`);
  const base = 'https://r2.example.test';
  const previous = { R2_PUBLIC_BASE_URL: process.env.R2_PUBLIC_BASE_URL, R2_BUCKET: process.env.R2_BUCKET };
  Object.assign(process.env, { R2_PUBLIC_BASE_URL: base, R2_BUCKET: 'test-bucket' });
  t.after(() => { for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
  const uuid = n => `12345678-1234-4234-8234-${String(n).padStart(12, '0')}`;
  const liveId = uuid(100), owner = uuid(101);
  let objects, copies, failCopy, updates, failUpdate;
  const database = {
    release() {},
    async query(sql, params) {
      if (sql.includes('UPDATE public.videos') && ++updates === failUpdate) throw new Error('Injected database failure');
      return client.query(sql.replaceAll('public.', 'pg_temp.'), params);
    },
  };
  mock.module(new URL('../src/database/index.js', import.meta.url).href, { namedExports: {
    writePool: { async connect() { return database; } },
  } });
  mock.module(new URL('../src/modules/storage/r2.client.js', import.meta.url).href, { namedExports: { s3: {
    async send(command) {
      const { Key, Body, CopySource } = command.input;
      switch (command.constructor.name) {
        case 'PutObjectCommand': objects.set(Key, Body); break;
        case 'CopyObjectCommand': {
          if (++copies === failCopy) throw new Error('Injected copy failure');
          const source = decodeURIComponent(CopySource).slice('test-bucket/'.length);
          assert.ok(objects.has(source));
          objects.set(Key, Buffer.from(objects.get(source)));
          break;
        }
        case 'DeleteObjectCommand': objects.delete(Key); break;
        default: throw new Error('Unexpected storage operation');
      }
    },
  } } });
  const { liveThumbnailUploadInternal: upload } = await import('../src/modules/live-streams/handlers/liveThumbnailUpload.js');
  const buffer = await sharp({ create: { width: 20, height: 40, channels: 3, background: '#ff0000' } }).png().toBuffer();
  const file = { buffer, size: buffer.length, mimetype: 'image/png' };
  const params = { liveStreamId: liveId };
  const readVideos = async () => (await client.query('SELECT * FROM pg_temp.videos ORDER BY id')).rows;
  async function reset() {
    objects = new Map(); copies = 0; updates = 0; failCopy = 0; failUpdate = 0;
    await client.query('TRUNCATE pg_temp.live_streams, pg_temp.videos');
    const liveKey = `live-stream-thumbnails/${liveId}/old.webp`;
    objects.set(liveKey, Buffer.from('old live thumbnail'));
    await client.query('INSERT INTO pg_temp.live_streams(id,user_id,thumbnail_url) VALUES ($1,$2,$3)', [liveId, owner, `${base}/${liveKey}`]);
    for (const [i, status, parent] of [
      [1, 'preparing', liveId], [2, 'preparing', liveId], [3, 'ready', liveId],
      [4, 'errored', liveId], [5, 'deleted', liveId], [6, null, liveId],
      [7, 'preparing', uuid(200)], [8, 'preparing', null],
    ]) {
      const key = `video-thumbnails/${uuid(i)}/old.webp`;
      objects.set(key, Buffer.from(`old thumbnail ${i}`));
      await client.query('INSERT INTO pg_temp.videos(id,live_stream_id,mux_status,thumbnail_url) VALUES ($1,$2,$3,$4)',
        [uuid(i), parent, status, `${base}/${key}`]);
    }
  }

  await t.test('replacement copies bytes independently to preparing recordings only', async () => {
    await reset();
    const before = await readVideos();
    const result = await upload({ params, file }, owner);
    const liveKey = result.live_stream.thumbnail_url.slice(base.length + 1);
    const after = await readVideos();
    assert.equal(copies, 2);
    assert.notEqual(after[0].thumbnail_url, after[1].thumbnail_url);
    for (const recording of after.slice(0, 2)) {
      const key = recording.thumbnail_url.slice(base.length + 1);
      assert.ok(key.startsWith(`video-thumbnails/${recording.id}/`));
      assert.notEqual(key, liveKey);
      assert.deepEqual(objects.get(key), objects.get(liveKey));
      assert.equal(objects.has(`video-thumbnails/${recording.id}/old.webp`), false);
    }
    assert.deepEqual(after.slice(2), before.slice(2));
    for (const recording of before.slice(2)) assert.ok(objects.has(recording.thumbnail_url.slice(base.length + 1)));
    assert.equal(objects.has(`live-stream-thumbnails/${liveId}/old.webp`), false);
  });

  await t.test('removal clears preparing thumbnails and retains all other recordings', async () => {
    await reset();
    const before = await readVideos();
    assert.equal((await upload({ params }, owner)).live_stream.thumbnail_url, null);
    const after = await readVideos();
    assert.deepEqual(after.slice(0, 2).map(v => v.thumbnail_url), [null, null]);
    assert.deepEqual(after.slice(2), before.slice(2));
    assert.equal(objects.size, 6);
    assert.equal(copies, 0);
  });

  await t.test('partial copy or database failure rolls back every URL and removes unused new files', async () => {
    for (const failure of ['copy', 'database']) {
      await reset();
      const before = await readVideos();
      const oldObjects = new Map(objects);
      if (failure === 'copy') failCopy = 2; else failUpdate = 2;
      await assert.rejects(upload({ params, file }, owner), /Injected/);
      assert.deepEqual(await readVideos(), before);
      assert.deepEqual(objects, oldObjects);
      assert.equal((await client.query('SELECT thumbnail_url FROM pg_temp.live_streams')).rows[0].thumbnail_url,
        `${base}/live-stream-thumbnails/${liveId}/old.webp`);
    }
  });
});
