import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mock, test } from 'node:test';
import jwt from 'jsonwebtoken';

const id = '12345678-1234-4234-8234-123456789abc';
const owner = '12345678-1234-4234-8234-123456789def';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.MUX_SIGNING_KEY = 'details-test-key';
process.env.MUX_PRIVATE_KEY = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64');
let video;
let queries;
let permitted;
mock.module(new URL('../src/database/index.js', import.meta.url).href, {
  namedExports: {
    writePool: { async query(sql, params) {
      queries.push({ sql, params });
      return { rows: permitted ? [{ ...video }] : [] };
    } },
    readPool: { async query(sql) {
      return { rows: sql.includes('COUNT(*)::int AS total') ? [{ total: 3 }] : [] };
    } },
  },
});
const { getVideoByIdInternal } = await import('../src/modules/videos/video/handlers/getVideoById.js');

function setup(overrides = {}) {
  video = {
    id, title: 'Video', mux_status: 'ready', playback_policy: 'public',
    mux_playback_id: 'playback-id', thumbnail_url: 'https://image.mux.com/stored/thumbnail.jpg?time=9',
    thumbnail_settings: null, duration_seconds: 120,
    chapters: [{ title: 'Introduction', startTime: 0 }, { title: 'Example', startTime: 42.5 }],
    ...overrides,
  };
  permitted = true;
  queries = [];
}

test('public video details remove stream_url and include card and chapter image URLs', async () => {
  setup();
  const result = await getVideoByIdInternal(id);
  assert.equal('stream_url' in result, false);
  assert.equal(result.thumbnail_url, video.thumbnail_url);
  assert.ok(result.mux_thumbnail_url);
  assert.ok(result.preview_url);
  assert.equal(result.comment_count, 3);
  assert.equal(result.media_expires_at, null);
  for (let i = 0; i < result.chapters.length; i++) {
    const chapter = result.chapters[i];
    const url = new URL(chapter.thumbnail_url);
    assert.equal(chapter.title, video.chapters[i].title);
    assert.equal(Number(url.searchParams.get('time')), chapter.startTime);
    assert.equal(url.searchParams.get('width'), '1280');
    assert.equal(url.searchParams.get('height'), '720');
    assert.equal(url.searchParams.has('token'), false);
  }
  assert.equal(video.chapters[0].thumbnail_url, undefined);
  assert.deepEqual(queries[0].params, [id]);
  assert.ok(!queries[0].sql.includes('$2'));
  assert.ok(!queries[0].sql.includes('stream_url'));
});

test('signed chapter tokens use each startTime, saved dimensions, and thumbnail audience', async () => {
  setup({ playback_policy: 'signed', thumbnail_settings: { time: 99, width: 640, height: 360, fit_mode: 'crop' }, progress_seconds: 80 });
  const result = await getVideoByIdInternal(id, owner);
  for (const chapter of result.chapters) {
    const url = new URL(chapter.thumbnail_url);
    assert.deepEqual([...url.searchParams.keys()], ['token']);
    const claims = jwt.verify(url.searchParams.get('token'), publicKey, { algorithms: ['RS256'], audience: 't', subject: 'playback-id' });
    assert.equal(claims.time, chapter.startTime);
    assert.equal(claims.width, 640);
    assert.equal(claims.height, 360);
    assert.equal(claims.fit_mode, 'crop');
    assert.ok(claims.exp >= result.media_expires_at);
  }
  const preview = jwt.verify(new URL(result.preview_url).searchParams.get('token'), publicKey, { audience: 'g' });
  assert.equal(preview.start, 80);
  assert.equal(preview.end, 85);
  assert.deepEqual(queries[0].params, [id, owner]);
  assert.match(queries[0].sql, /v.uploaded_by = \$2/);
  assert.ok(!queries[0].sql.includes('$3'));
});

test('videos with null or empty chapters preserve their chapter shape', async () => {
  for (const chapters of [null, []]) {
    setup({ chapters, thumbnail_url: null });
    const result = await getVideoByIdInternal(id);
    assert.deepEqual(result.chapters, chapters);
    assert.equal(result.thumbnail_url, null);
    assert.ok(result.mux_thumbnail_url);
  }
});

test('invalid chapter times receive null URLs and times past the end are clamped', async () => {
  setup({ chapters: [{ title: 'Invalid', startTime: -1 }, { title: 'Missing' }, { title: 'Past end', startTime: 999 }] });
  const result = await getVideoByIdInternal(id);
  assert.equal(result.chapters[0].thumbnail_url, null);
  assert.equal(result.chapters[1].thumbnail_url, null);
  assert.equal(Number(new URL(result.chapters[2].thumbnail_url).searchParams.get('time')), 119.999);
});

test('missing or inaccessible videos return null before image generation', async () => {
  setup();
  permitted = false;
  assert.equal(await getVideoByIdInternal(id), null);
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /v.visibility = 'public'/);
});
