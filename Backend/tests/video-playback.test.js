import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mock, test } from 'node:test';
import jwt from 'jsonwebtoken';

const videoId = '12345678-1234-4234-8234-123456789abc';
const ownerId = '12345678-1234-4234-8234-123456789def';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const encodedKey = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64');
const baseVideo = {
  id: videoId,
  uploaded_by: ownerId,
  visibility: 'public',
  mux_status: 'ready',
  mux_playback_id: 'stored-playback-id',
  playback_policy: 'signed',
  duration_seconds: 120,
};
let video;
let queries;
let importId = 0;

mock.module(new URL('../src/database/index.js', import.meta.url).href, {
  namedExports: {
    writePool: {
      async query(sql, params) {
        queries.push({ sql, params });
        return { rows: video ? [video] : [] };
      },
    },
  },
});

async function loadHandler(overrides = {}, signing = true) {
  video = { ...baseVideo, ...overrides };
  queries = [];
  // Only generated test credentials are used; no database or Mux API calls occur.
  process.env.MUX_SIGNING_KEY = signing ? 'test-signing-key' : '';
  process.env.MUX_PRIVATE_KEY = signing ? encodedKey : '';
  const module = await import(`../src/modules/videos/video/handlers/getVideoPlayback.js?test=${++importId}`);
  return module.getVideoPlaybackInternal;
}

test('guests can obtain signed playback for public visibility, with valid scoped JWTs', async () => {
  const getPlayback = await loadHandler();
  const before = Math.floor(Date.now() / 1000);
  const result = await getPlayback(videoId);
  assert.equal(result.video_id, videoId);
  assert.equal(result.mux_playback_id, baseVideo.mux_playback_id);
  assert.equal(result.playback_policy, 'signed');
  assert.equal(new URL(result.stream_url).searchParams.get('token'), result.tokens.playback);
  for (const [type, audience] of Object.entries({ playback: 'v', thumbnail: 't', storyboard: 's' })) {
    const verified = jwt.verify(result.tokens[type], publicKey, {
      algorithms: ['RS256'], subject: baseVideo.mux_playback_id, audience, complete: true,
    });
    assert.equal(verified.payload.kid, 'test-signing-key');
    assert.ok(verified.payload.exp >= result.expires_at);
    assert.ok(verified.payload.exp <= Math.floor(Date.now() / 1000) + 3600);
  }
  assert.ok(result.expires_at >= before + 3600);
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql.trim(), /^SELECT/);
  assert.deepEqual(queries[0].params, [videoId]);
});

test('private videos allow only the uploader, for either playback policy', async () => {
  for (const playback_policy of ['public', 'signed']) {
    const getPlayback = await loadHandler({ visibility: 'private', playback_policy });
    for (const viewer of [null, 'another-user']) {
      await assert.rejects(getPlayback(videoId, viewer), { status: 404 });
    }
    const result = await getPlayback(videoId, ownerId);
    assert.equal(result.playback_policy, playback_policy);
  }
});

test('missing and unsupported visibility videos are not disclosed even to the uploader', async () => {
  const getPlayback = await loadHandler({ visibility: 'hidden' });
  await assert.rejects(getPlayback(videoId, ownerId), { status: 404 });
  video = null;
  await assert.rejects(getPlayback(videoId), { status: 404 });
});

test('malformed IDs are rejected before querying the database', async () => {
  const getPlayback = await loadHandler();
  for (const id of [undefined, '', 'not-a-uuid', "' OR 1=1 --"]) {
    await assert.rejects(getPlayback(id), { status: 400 });
  }
  assert.equal(queries.length, 0);
});

test('unready videos and missing playback IDs cannot receive playback credentials', async () => {
  for (const overrides of [{ mux_status: 'processing' }, { mux_status: 'errored' }, { mux_playback_id: null }]) {
    const getPlayback = await loadHandler(overrides);
    await assert.rejects(getPlayback(videoId), { status: 409 });
  }
});

test('public playback works without signing credentials', async () => {
  const getPlayback = await loadHandler({ playback_policy: 'public' }, false);
  const result = await getPlayback(videoId);
  assert.equal(result.stream_url, `https://stream.mux.com/${baseVideo.mux_playback_id}.m3u8`);
  assert.deepEqual(result.tokens, {});
  assert.equal(result.expires_at, null);
});

test('missing signing configuration and unknown policies fail without a public fallback', async () => {
  let getPlayback = await loadHandler({}, false);
  await assert.rejects(getPlayback(videoId), { status: 503 });
  for (const playback_policy of [null, 'unknown']) {
    getPlayback = await loadHandler({ playback_policy });
    await assert.rejects(getPlayback(videoId), { status: 503 });
  }
});

test('long videos receive enough time for their duration and pause buffer', async () => {
  const getPlayback = await loadHandler({ duration_seconds: 10800 });
  const before = Math.floor(Date.now() / 1000);
  const result = await getPlayback(videoId);
  assert.ok(result.expires_at >= before + 10800 + 1800);
  assert.ok(jwt.decode(result.tokens.playback).exp >= result.expires_at);
});

test('each request rechecks access after a visibility change', async () => {
  const getPlayback = await loadHandler();
  await getPlayback(videoId);
  video.visibility = 'private';
  await assert.rejects(getPlayback(videoId), { status: 404 });
  assert.equal(queries.length, 2);
});
