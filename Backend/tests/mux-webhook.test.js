import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, beforeEach, mock, test } from 'node:test';

const previousSecret = process.env.MUX_WEBHOOK_SECRET;
process.env.MUX_WEBHOOK_SECRET = 'webhook-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.MUX_WEBHOOK_SECRET;
  else process.env.MUX_WEBHOOK_SECRET = previousSecret;
});
let calls;
const client = {
  async query(sql, values) { calls.push([sql, values]); return { rows: [] }; },
  release() {},
};
mock.module(new URL('../src/database/index.js', import.meta.url).href, {
  namedExports: { writePool: { ...client, async connect() { return client; } } },
});
mock.module(new URL('../src/modules/video-indexing/mux-source.service.js', import.meta.url).href, {
  namedExports: { async reconcileTracks(...args) { calls.push(['reconcile', args]); } },
});
const { muxWebhookInternal: webhook } = await import('../src/modules/videos/video/handlers/muxWebhook.js');
beforeEach(() => { calls = []; });
const videoId = '12345678-1234-4234-8234-123456789abc';
function signed(event, timestamp = Math.floor(Date.now() / 1000)) {
  const body = Buffer.isBuffer(event) ? event : Buffer.from(JSON.stringify(event));
  const hash = crypto.createHmac('sha256', process.env.MUX_WEBHOOK_SECRET)
    .update(`${timestamp}.`).update(body).digest('hex');
  return { body, headers: { 'mux-signature': `t=${timestamp},v1=${hash}` } };
}

test('invalid, expired and tampered signatures perform no database work or payload logging', async t => {
  const log = t.mock.method(console, 'log', () => {});
  const event = { type: 'video.live_stream.active', data: { id: 'live' } };
  await assert.rejects(webhook({ body: event }), { status: 401 });
  await assert.rejects(webhook(signed(event, Math.floor(Date.now() / 1000) - 600)), { status: 401 });
  const request = signed(event);
  request.body = Buffer.from(JSON.stringify({ ...event, data: { id: 'changed' } }));
  await assert.rejects(webhook(request), { status: 401 });
  assert.deepEqual(calls, []);
  assert.equal(log.mock.callCount(), 0);
});

test('verified webhook payloads are logged with nested credentials redacted', async t => {
  const log = t.mock.method(console, 'log', () => {});
  const event = { id: 'event-id', type: 'video.live_stream.warning', data: {
    id: 'live-id', status: 'active', stream_key: 'private-key',
    nested: [{ srt_passphrase: 'private-passphrase', token: 'private-token' }],
    url: 'https://example.com/video?token=private-url-token&time=10',
    simulcast: { url: 'rtmp://example.com/app/private-destination-key' },
  } };
  await webhook(signed(event));
  const [prefix, json] = log.mock.calls[0].arguments;
  assert.equal(prefix, '[Mux webhook]');
  const logged = JSON.parse(json);
  assert.equal(logged.type, event.type);
  assert.equal(logged.data.status, 'active');
  assert.equal(logged.data.stream_key, '[REDACTED]');
  assert.equal(logged.data.nested[0].srt_passphrase, '[REDACTED]');
  assert.equal(logged.data.nested[0].token, '[REDACTED]');
  assert.equal(new URL(logged.data.url).searchParams.get('token'), 'REDACTED');
  assert.equal(logged.data.simulcast.url, '[REDACTED ENCODER URL]');
  assert.ok(!json.includes('private-'));
  assert.equal(event.data.stream_key, 'private-key');
});

test('signed malformed JSON and malformed envelopes return 400', async () => {
  for (const event of [Buffer.from('{bad'), { type: 7, data: {} }, { type: 'video.asset.ready', data: [] }]) {
    await assert.rejects(webhook(signed(event)), { status: 400 });
  }
  assert.deepEqual(calls, []);
});

test('ordinary upload ready still updates its video and reconciles tracks', async () => {
  assert.deepEqual(await webhook(signed({ type: 'video.asset.ready', data: {
    id: 'upload-asset', passthrough: videoId, duration: 100.5,
    playback_ids: [{ id: 'upload-playback', policy: 'signed' }],
  } })), { received: true });
  const update = calls.find(([sql]) => sql.includes('UPDATE public.videos'));
  assert.deepEqual(update[1], [videoId, 101, 'upload-asset', 'upload-playback', 'https://image.mux.com/upload-playback/thumbnail.jpg?time=0']);
  assert.deepEqual(calls.at(-1), ['reconcile', ['upload-asset', videoId]]);
});

test('ordinary upload error and deletion keep their existing behavior', async () => {
  await webhook(signed({ type: 'video.asset.errored', data: { id: 'upload-asset', passthrough: videoId } }));
  assert.ok(calls.some(([sql]) => sql.includes("mux_status = 'errored'")));
  await webhook(signed({ type: 'video.asset.deleted', data: { id: 'upload-asset', passthrough: videoId } }));
  assert.deepEqual(calls.find(([sql]) => sql.includes('DELETE FROM public.videos'))[1], ['upload-asset', videoId]);
});

test('unknown live assets never fall through to ordinary video updates or deletion', async () => {
  for (const type of ['created', 'ready', 'errored', 'deleted', 'live_stream_completed']) {
    await webhook(signed({ type: `video.asset.${type}`, data: { id: 'unknown-asset', live_stream_id: 'unknown-live', passthrough: videoId } }));
  }
  assert.ok(!calls.some(([sql]) => /^(UPDATE|DELETE|reconcile)/.test(sql.trim())));
});

test('track events still use the existing reconciliation handler', async () => {
  await webhook(signed({ type: 'video.asset.track.ready', data: { id: 'track', asset_id: 'asset' } }));
  assert.deepEqual(calls, [['reconcile', ['asset']]]);
});

test('warnings and unsupported events are acknowledged without changing lifecycle', async () => {
  for (const type of ['video.live_stream.warning', 'video.live_stream.simulcast_target.errored', 'unknown.event']) {
    assert.deepEqual(await webhook(signed({ type, data: { id: 'resource' } })), { received: true });
  }
  assert.deepEqual(calls, []);
});
