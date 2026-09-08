import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mock, test } from 'node:test';
import jwt from 'jsonwebtoken';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.MUX_SIGNING_KEY = 'subtitle-test-key';
process.env.MUX_PRIVATE_KEY = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64');
let video;
mock.module(new URL('../src/database/index.js', import.meta.url).href, {
  namedExports: { readPool: { async query() { return { rows: video ? [video] : [] }; } } },
});
const { getSubtitleInternal } = await import('../src/modules/videos/video-moderation/handlers/getSubtitle.js');
const { getMuxVttUrl, fetchVttFromMux } = await import('../src/modules/videos/helpers/videoModeration.shared.js');
const vtt = 'WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n';
const input = { params: { videoId: '12345678-1234-4234-8234-123456789abc' }, query: { lang: 'en' } };

function stubFetch(t, { policy = 'signed', status = 200, trackStatus = 'ready' } = {}) {
  video = { mux_status: 'ready', mux_asset_id: 'asset-123', mux_playback_id: 'playback-123', playback_policy: policy };
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(String(url));
    if (String(url).startsWith('https://api.mux.com/')) {
      return Response.json({ data: { tracks: [{ id: 'track-123', type: 'text', text_type: 'subtitles', language_code: 'en', status: trackStatus }] } });
    }
    assert.ok(String(url).startsWith('https://stream.mux.com/playback-123/text/track-123.vtt'));
    return new Response(status === 200 ? vtt : 'Not Authorized', { status });
  });
  return calls;
}

test('signed subtitle endpoint downloads VTT with a valid video token', async (t) => {
  const calls = stubFetch(t);
  const result = await getSubtitleInternal(input);
  assert.equal(result.status, 200);
  assert.equal(result.format, 'send');
  assert.equal(result.body, vtt);
  assert.equal(result.headers['Content-Type'], 'text/vtt; charset=utf-8');
  assert.equal(result.headers['Cache-Control'], 'private, no-store');
  const url = new URL(calls[1]);
  const claims = jwt.verify(url.searchParams.get('token'), publicKey, { algorithms: ['RS256'], audience: 'v', subject: 'playback-123' });
  assert.equal(claims.kid, 'subtitle-test-key');
  assert.ok(claims.exp > Math.floor(Date.now() / 1000));
  assert.ok(claims.exp <= Math.floor(Date.now() / 1000) + 300);
  assert.ok(!JSON.stringify(result.headers).includes('token='));
});

test('public subtitle requests remain unsigned', async (t) => {
  const calls = stubFetch(t, { policy: 'public' });
  const result = await getSubtitleInternal(input);
  assert.equal(result.body, vtt);
  assert.equal(new URL(calls[1]).search, '');
});

test('unready subtitle tracks retain the processing response without fetching VTT', async (t) => {
  const calls = stubFetch(t, { trackStatus: 'preparing' });
  const result = await getSubtitleInternal(input);
  assert.equal(result.status, 202);
  assert.equal(result.body.code, 'CAPTIONS_PROCESSING');
  assert.equal(calls.length, 1);
});

test('VTT propagation delays remain processing responses', async (t) => {
  stubFetch(t, { status: 404 });
  const result = await getSubtitleInternal(input);
  assert.equal(result.status, 202);
  assert.equal(result.body.code, 'CAPTIONS_PROCESSING');
});

test('upstream errors do not return the signing token', async (t) => {
  stubFetch(t, { status: 403 });
  await assert.rejects(getSubtitleInternal(input), error => {
    assert.equal(error.status, 502);
    assert.equal(error.body.status, 403);
    assert.equal(new URL(error.body.vtt_url).search, '');
    return true;
  });
});

test('shared VTT downloader used by translation signs the request too', async (t) => {
  const calls = stubFetch(t);
  const result = await fetchVttFromMux('playback-123', 'track-123', 'signed');
  assert.equal(result.vttText, vtt);
  jwt.verify(new URL(calls[0]).searchParams.get('token'), publicKey, { audience: 'v', subject: 'playback-123' });
  assert.equal(new URL(result.vttUrl).search, '');
});

test('unknown playback policies fail closed', async () => {
  await assert.rejects(getMuxVttUrl('playback-123', 'track-123', null), { status: 503 });
});

test('missing signing keys fail clearly while public VTT URLs still work', async () => {
  process.env.MUX_SIGNING_KEY = '';
  process.env.MUX_PRIVATE_KEY = '';
  const helper = await import('../src/modules/videos/helpers/videoModeration.shared.js?missing-keys');
  await assert.rejects(helper.getMuxVttUrl('playback-123', 'track-123', 'signed'), {
    status: 503, message: 'Signed subtitles are not configured',
  });
  assert.equal(await helper.getMuxVttUrl('playback-123', 'track-123', 'public'),
    'https://stream.mux.com/playback-123/text/track-123.vtt');
});
