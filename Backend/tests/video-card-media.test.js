import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mock, test } from 'node:test';
import jwt from 'jsonwebtoken';

const id = '12345678-1234-4234-8234-123456789abc';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const encodedKey = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64');
const base = {
  id, mux_playback_id: 'playback-123', playback_policy: 'public', mux_status: 'ready',
  thumbnail_url: null, mux_thumbnail_time: null, duration_seconds: 120,
};
let rows;
let queries;
let instance = 0;
mock.module(new URL('../src/database/index.js', import.meta.url).href, {
  namedExports: {
    writePool: { async query(sql, params) { queries.push({ sql, params }); return { rows }; } },
    readPool: { async query(sql) {
      return { rows: sql.includes('COUNT(*)') ? [{ total: 1 }] : [{ id, title: 'Video', thumbnail_url: 'stale-url' }] };
    } },
  },
});

async function setup(overrides = {}, signed = true) {
  rows = [{ ...base, ...overrides }];
  queries = [];
  process.env.MUX_SIGNING_KEY = signed ? 'test-image-key' : '';
  process.env.MUX_PRIVATE_KEY = signed ? encodedKey : '';
  return (await import(`../src/modules/videos/helpers/videoCardMedia.js?test=${++instance}`)).withVideoCardMedia;
}

test('public card URLs preserve custom thumbnails and use saved time and backend image settings', async () => {
  const enrich = await setup({
    thumbnail_url: 'https://cdn.example.test/custom.png',
    mux_thumbnail_time: 12,
  }, false);
  const [card] = await enrich([{ id, title: 'Video' }]);
  assert.equal(card.thumbnail_url, 'https://cdn.example.test/custom.png');
  assert.equal(card.title, 'Video');
  const thumb = new URL(card.mux_thumbnail_url);
  assert.equal(thumb.pathname, '/playback-123/thumbnail.webp');
  assert.deepEqual(Object.fromEntries(thumb.searchParams), { time: '12', width: '1280', height: '720', fit_mode: 'preserve' });
  assert.equal(new URL(card.preview_url).searchParams.get('start'), '60');
  assert.equal(card.media_expires_at, null);
});

test('signed thumbnail and animated WebP URLs contain distinct verifiable image tokens', async () => {
  const enrich = await setup({ playback_policy: 'signed', mux_thumbnail_time: 12 });
  const [card] = await enrich([{ id, progress_seconds: 117 }]);
  for (const [field, audience] of [['mux_thumbnail_url', 't'], ['preview_url', 'g']]) {
    const url = new URL(card[field]);
    assert.deepEqual([...url.searchParams.keys()], ['token']);
    const claims = jwt.verify(url.searchParams.get('token'), publicKey, { algorithms: ['RS256'], audience, subject: base.mux_playback_id });
    assert.equal(claims.kid, 'test-image-key');
    assert.ok(claims.exp >= card.media_expires_at);
    if (audience === 't') {
      assert.equal(claims.time, 12);
      assert.equal(claims.width, 1280);
    } else {
      assert.equal(claims.start, 117);
      assert.equal(claims.end, 120);
      assert.equal(claims.fps, 10);
    }
  }
  assert.equal(card.thumbnail_url, null);
});

test('stored Mux thumbnail URLs stay unchanged and absent timestamps use defaults for either policy', async () => {
  const storedUrl = 'https://image.mux.com/old-id/thumbnail.jpg?time=24&width=640&height=360';
  for (const playback_policy of ['public', 'signed']) {
    for (const mux_thumbnail_time of [null, undefined, 0]) {
      const enrich = await setup({ thumbnail_url: storedUrl, mux_thumbnail_time, playback_policy });
      const [card] = await enrich([{ id }]);
      assert.equal(card.thumbnail_url, storedUrl);
      const url = new URL(card.mux_thumbnail_url);
      assert.equal(url.pathname, '/playback-123/thumbnail.webp');
      const params = playback_policy === 'signed'
        ? jwt.verify(url.searchParams.get('token'), publicKey, { audience: 't', subject: base.mux_playback_id })
        : Object.fromEntries(url.searchParams);
      assert.equal(Number(params.time), 0);
      assert.equal(Number(params.width), 1280);
      assert.equal(Number(params.height), 720);
      assert.equal(params.fit_mode, 'preserve');
    }
  }
});

test('legacy settings cannot override the token scope or lifetime', async () => {
  const enrich = await setup({ playback_policy: 'signed', thumbnail_settings: {
    sub: 'other-video', aud: 'v', exp: 9999999999, token: 'bad', time: -1, width: 'bad', fit_mode: 'invalid',
  } });
  const [card] = await enrich([{ id }]);
  const claims = jwt.verify(new URL(card.mux_thumbnail_url).searchParams.get('token'), publicKey, {
    audience: 't', subject: base.mux_playback_id,
  });
  assert.ok(claims.exp <= Math.floor(Date.now() / 1000) + 3600);
  assert.equal(claims.token, undefined);
  assert.equal(claims.time, 0);
  assert.equal(claims.width, 1280);
});

test('stale inaccessible cards receive no media URLs; lookup batches IDs and checks access', async () => {
  const enrich = await setup();
  rows = [];
  const [card] = await enrich([{ id, thumbnail_url: 'stale-url' }, { id }], 'viewer-id');
  assert.equal(card.thumbnail_url, null);
  assert.equal(card.mux_thumbnail_url, null);
  assert.equal(card.preview_url, null);
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].params, [[id], 'viewer-id']);
  assert.match(queries[0].sql, /visibility = 'public' OR \(visibility = 'private' AND uploaded_by = \$2\)/);
});

test('unready videos retain stored thumbnails and empty lists skip the database', async () => {
  const enrich = await setup({ mux_status: 'processing', thumbnail_url: 'https://cdn.example.test/custom.webp' });
  assert.deepEqual(await enrich([]), []);
  assert.equal(queries.length, 0);
  const [card] = await enrich([{ id }]);
  assert.equal(card.thumbnail_url, rows[0].thumbnail_url);
  assert.equal(card.mux_thumbnail_url, null);
  assert.equal(card.preview_url, null);
});

test('completed progress is clamped and sub-250ms videos have no animated preview', async () => {
  let enrich = await setup();
  let [card] = await enrich([{ id, progress_seconds: 9999 }]);
  assert.equal(new URL(card.preview_url).searchParams.get('start'), '119.75');
  assert.equal(new URL(card.preview_url).searchParams.get('end'), '120');
  enrich = await setup({ duration_seconds: 0.1 });
  [card] = await enrich([{ id }]);
  assert.equal(card.preview_url, null);
});

test('signed images never fall back to unsigned links when keys are absent', async () => {
  const enrich = await setup({ playback_policy: 'signed' }, false);
  await assert.rejects(enrich([{ id }]), { status: 503 });
});

test('search responses include enriched card URLs without changing pagination', async () => {
  await setup();
  const { searchVideosInternal } = await import('../src/modules/videos/video/handlers/searchVideos.js');
  const result = await searchVideosInternal({ limit: 20 });
  assert.equal(result.videos[0].thumbnail_url, null);
  assert.ok(result.videos[0].mux_thumbnail_url);
  assert.ok(result.videos[0].preview_url);
  assert.equal(result.total, 1);
  assert.equal(result.limit, 20);
});
