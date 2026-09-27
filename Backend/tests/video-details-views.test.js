import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';

const id = '12345678-1234-4234-8234-123456789abc';
const userId = '12345678-1234-4234-8234-123456789def';
let video, queries, accessible, existing, databaseFailure, geoLookups;
const db = {
  async connect() { queries.push('connect'); return { query: db.query, release() { queries.push('release'); } }; },
  async query(sql) {
    queries.push(sql.trim());
    if (['BEGIN', 'ROLLBACK', 'COMMIT'].includes(sql)) return { rows: [] };
    if (sql.includes('SELECT id FROM public.videos')) return { rows: accessible ? [{ id }] : [] };
    if (sql.includes('FROM video_views')) return { rows: existing ? [{ id: 'view-id', last_seq: 4 }] : [] };
    if (sql.includes('INSERT INTO video_views')) {
      if (databaseFailure) throw new Error('database unavailable');
      return { rows: [{ id: 'view-id', last_seq: 0 }] };
    }
    if (sql.includes('UPDATE videos SET view_count')) return { rows: [] };
    assert.fail(`Unexpected SQL: ${sql}`);
  },
};
mock.module(new URL('../src/database/index.js', import.meta.url).href, { namedExports: { writePool: db, readPool: db } });
mock.module(new URL('../src/modules/videos/video/handlers/getVideoById.js', import.meta.url).href, {
  namedExports: { getVideoByIdInternal: async () => structuredClone(video) },
});
mock.module(new URL('../src/common/logger.js', import.meta.url).href, { namedExports: { logEvent() {} } });
mock.module(new URL('../src/common/ip.js', import.meta.url).href, { namedExports: {
  getClientIp: () => '127.0.0.1', normalizeIp: ip => ip, hashIp: () => 'hashed-ip',
  getCountryAndCityFromIp: async () => { geoLookups++; return { country: null, city: null, country_iso: null }; },
} });
const { handleGetVideoById } = await import('../src/modules/videos/video/video.controller.js');
const { incrementViewCountInternal } = await import('../src/modules/videos/video/handlers/incrementViewCount.js');

beforeEach(() => {
  video = { id, kind: 'upload', title: 'Video', mux_status: 'ready', mux_playback_id: 'recording-id' };
  queries = []; accessible = true; existing = false; databaseFailure = false; geoLookups = 0;
});

async function details() {
  const res = { code: 200, set() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await handleGetVideoById({ params: { id }, user: { sub: userId }, get: () => 'test-player' }, res);
  return res;
}

test('unplayable livestream pages return details without attempting to count a view', async t => {
  const warn = t.mock.method(console, 'warn', () => {});
  const error = t.mock.method(console, 'error', () => {});
  for (const livestream of [
    { status: 'scheduled', mode: 'standard' },
    { status: 'cancelled', mode: 'standard' },
    { status: 'ended', mode: 'standard', recording_finalized_at: null },
    { status: 'live', mode: 'standard', mux_live_playback_id: 'live-id', policy_sync_pending: true },
    { status: 'live', mode: 'standard', mux_live_playback_id: 'live-id', stop_at: '2000-01-01T00:00:00Z' },
    { status: 'live', mode: 'dvr' },
  ]) {
    video = { ...video, kind: 'live', mux_status: 'preparing', livestream };
    const res = await details();
    assert.equal(res.code, 200);
    assert.equal(res.body.id, id);
    assert.equal(res.body.view, null);
  }
  assert.deepEqual(queries, []);
  assert.equal(geoLookups, 0);
  assert.equal(warn.mock.callCount(), 0);
  assert.equal(error.mock.callCount(), 0);
});

test('uploads, active standard/DVR streams and finalized replays still open viewing sessions', async () => {
  for (const overrides of [
    {},
    { kind: 'live', mux_status: 'preparing', livestream: { status: 'live', mode: 'standard', mux_live_playback_id: 'live-id' } },
    { kind: 'live', mux_status: 'ready', livestream: { status: 'live', mode: 'dvr' } },
    { kind: 'live', mux_status: 'ready', livestream: { status: 'ended', recording_finalized_at: '2026-01-01T00:00:00Z' } },
  ]) {
    video = { ...video, ...overrides };
    queries = [];
    const res = await details();
    assert.equal(res.code, 200);
    assert.deepEqual(res.body.view, { view_id: 'view-id', last_seq: 0, counted: true });
    assert.ok(queries.some(sql => sql.startsWith('UPDATE videos SET view_count')));
    assert.deepEqual(queries.slice(-2), ['COMMIT', 'release']);
  }
});

test('repeat views reuse the existing session without increasing the count', async () => {
  existing = true;
  const res = await details();
  assert.deepEqual(res.body.view, { view_id: 'view-id', last_seq: 4, counted: false });
  assert.ok(!queries.some(sql => sql.includes('INSERT INTO video_views') || sql.startsWith('UPDATE videos')));
});

test('a stream becoming unavailable after details are loaded skips tracking quietly', async t => {
  const warn = t.mock.method(console, 'warn', () => {});
  const error = t.mock.method(console, 'error', () => {});
  accessible = false;
  const res = await details();
  assert.equal(res.code, 200);
  assert.equal(res.body.view, null);
  assert.deepEqual(queries.slice(-2), ['ROLLBACK', 'release']);
  assert.equal(geoLookups, 0);
  assert.equal(warn.mock.callCount(), 0);
  assert.equal(error.mock.callCount(), 0);
});

test('genuine database failures remain observable and roll back without breaking details', async t => {
  const warn = t.mock.method(console, 'warn', () => {});
  const error = t.mock.method(console, 'error', () => {});
  databaseFailure = true;
  const res = await details();
  assert.equal(res.code, 200);
  assert.equal(res.body.view, null);
  assert.equal(warn.mock.callCount(), 1);
  assert.equal(error.mock.callCount(), 1);
  assert.deepEqual(queries.slice(-2), ['ROLLBACK', 'release']);
  await assert.rejects(incrementViewCountInternal(id, { userId }), /database unavailable/);
});

test('missing or inaccessible details retain 404 and never attempt view tracking', async () => {
  video = null;
  assert.equal((await details()).code, 404);
  assert.deepEqual(queries, []);
});
