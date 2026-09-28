import assert from 'node:assert/strict';
import { after, before, beforeEach, mock, test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';

const ownerId = '12345678-1234-4234-8234-123456789abc';
const otherUserId = '12345678-1234-4234-8234-123456789def';
const liveStreamId = '12345678-1234-4234-8234-123456789012';
const videoId = '12345678-1234-4234-8234-123456789013';
let row, calls, failures, stream, assets, failDatabaseDelete;

mock.module(new URL('../src/database/index.js', import.meta.url).href, {
  namedExports: { writePool: { async query(sql, values) {
    if (sql.includes('FROM users')) {
      return { rows: [{ id: values[0], status: 'active', authz_version: 1 }] };
    }
    if (sql.startsWith('DELETE')) {
      calls.push(['databaseDelete', ...values]);
      if (failDatabaseDelete) throw new Error('Database unavailable');
      row = null;
      return { rows: [] };
    }
    calls.push(['select', ...values]);
    if (sql.includes('ls.id = $1')) {
      assert.match(sql, /AND v.uploaded_by = \$2/);
      return { rows: row && values[0] === liveStreamId && values[1] === ownerId ? [row] : [] };
    }
    assert.match(sql, /WHERE v.id = \$1/);
    return { rows: row && values[0] === videoId ? [row] : [] };
  } } },
});

function muxCall(operation, id) {
  calls.push([operation, id]);
  const status = failures[`${operation}:${id}`] ?? failures[operation];
  if (status) throw Object.assign(new Error('private upstream credentials'), { status });
}
mock.module('@mux/mux-node', {
  defaultExport: class {
    video = {
      liveStreams: {
        async retrieve(id) { muxCall('retrieve', id); return stream; },
        async disable(id) { muxCall('disable', id); },
        async delete(id) { muxCall('deleteStream', id); },
      },
      assets: {
        list(params) {
          return { async asResponse() {
            muxCall('list', params.live_stream_id);
            calls.push(['listComplete']);
            return Response.json({ data: assets.map(id => ({ id })), next_cursor: null });
          } };
        },
        async delete(id) { muxCall('deleteAsset', id); },
      },
    };
  },
});
const { deleteLiveStreamInternal: deleteLive } = await import('../src/modules/live-streams/handlers/deleteLiveStream.js');
const { deleteVideoInternal } = await import('../src/modules/videos/video-moderation/handlers/deleteVideo.js');
const deleteVideo = () => deleteVideoInternal({ params: { videoId } });
const { default: router } = await import('../src/modules/live-streams/live-streams.routes.js');

beforeEach(() => {
  calls = []; failures = {}; failDatabaseDelete = false;
  row = { video_id: videoId, live_stream_id: liveStreamId, mux_asset_id: 'recording', mux_live_stream_id: 'mux-live' };
  stream = { active_asset_id: 'active-recording', recent_asset_ids: ['recording', 'older-recording'] };
  assets = ['recording', 'active-recording', 'older-recording', 'webhook-pending-recording'];
});

test('deletion stops ingest, collects every recording, deletes each once, then deletes the database video', async () => {
  const result = await deleteLive(liveStreamId, ownerId);
  assert.deepEqual(result, {
    success: true, video_id: videoId, live_stream_id: liveStreamId,
    mux_asset_id: 'recording', message: 'Live stream and recordings deleted.',
  });
  assert.deepEqual(calls, [
    ['select', liveStreamId, ownerId], ['retrieve', 'mux-live'], ['disable', 'mux-live'],
    ['list', 'mux-live'], ['listComplete'],
    ['deleteAsset', 'recording'], ['deleteAsset', 'active-recording'],
    ['deleteAsset', 'older-recording'], ['deleteAsset', 'webhook-pending-recording'],
    ['deleteStream', 'mux-live'], ['databaseDelete', videoId],
  ]);
});

test('a scheduled stream without a recording can be deleted', async () => {
  row.mux_asset_id = null; stream = {}; assets = [];
  await deleteLive(liveStreamId, ownerId);
  assert.equal(row, null);
  assert.ok(!calls.some(([name]) => name === 'deleteAsset'));
});

test('missing Mux stream and recording do not prevent database deletion', async () => {
  failures = { retrieve: 404, disable: 404, deleteAsset: 404, deleteStream: 404 };
  assets = [];
  await deleteLive(liveStreamId, ownerId);
  assert.equal(row, null);
  assert.ok(calls.some(([name, id]) => name === 'deleteAsset' && id === 'recording'));
});

test('ordinary video deletion immediately removes the local row even when Mux returns 404', async () => {
  row.live_stream_id = null; row.mux_live_stream_id = null;
  failures.deleteAsset = 404;
  await deleteVideo();
  assert.equal(row, null);
  assert.deepEqual(calls, [['select', videoId], ['deleteAsset', 'recording'], ['databaseDelete', videoId]]);
});

test('the existing video deletion handler also cleans up the associated Mux live stream', async () => {
  await deleteVideo();
  assert.ok(calls.some(([name]) => name === 'deleteStream'));
  assert.equal(row, null);
});

test('non-404 Mux failures preserve database records and redact upstream details', async t => {
  const logs = t.mock.method(console, 'error', () => {});
  for (const operation of ['retrieve', 'disable', 'list', 'deleteAsset', 'deleteStream']) {
    calls = []; failures = { [operation]: 503 };
    await assert.rejects(deleteLive(liveStreamId, ownerId), {
      status: 502, message: 'Unable to delete video resources from Mux',
    });
    assert.ok(row);
    assert.ok(!calls.some(([name]) => name === 'databaseDelete'));
  }
  assert.equal(logs.mock.callCount(), 5);
  assert.equal(logs.mock.calls[2].arguments[1].operation, 'list recordings');
  assert.equal(logs.mock.calls[2].arguments[1].status, 503);
  assert.ok(!JSON.stringify(logs.mock.calls.map(call => call.arguments)).includes('private upstream credentials'));
});

test('partial recording cleanup can be retried when deleted assets return 404', async () => {
  failures['deleteAsset:active-recording'] = 503;
  await assert.rejects(deleteLive(liveStreamId, ownerId), { status: 502 });
  assert.ok(row);
  failures = { 'deleteAsset:recording': 404 };
  await deleteLive(liveStreamId, ownerId);
  assert.equal(row, null);
});

test('a database failure after remote deletion can be retried', async () => {
  failDatabaseDelete = true;
  await assert.rejects(deleteLive(liveStreamId, ownerId), /Database unavailable/);
  assert.ok(row);
  failDatabaseDelete = false;
  failures = { retrieve: 404, disable: 404, deleteAsset: 404, deleteStream: 404 };
  assets = [];
  await deleteLive(liveStreamId, ownerId);
  assert.equal(row, null);
});

test('invalid IDs, missing authentication and other owners cannot delete resources', async () => {
  await assert.rejects(deleteLive(liveStreamId, null), { status: 401 });
  await assert.rejects(deleteLive('invalid', ownerId), { status: 400 });
  assert.deepEqual(calls, []);
  await assert.rejects(deleteLive(liveStreamId, otherUserId), { status: 404 });
  row = null;
  await assert.rejects(deleteLive(liveStreamId, ownerId), { status: 404 });
  assert.ok(calls.every(([name]) => name === 'select'));
});

let server, url, previousSecret;
before(async () => {
  previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'video-deletion-test-secret';
  const app = express();
  app.use('/api/live-streams', router);
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  url = `http://127.0.0.1:${server.address().port}/api/live-streams/${liveStreamId}`;
});
after(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});
const headers = userId => ({ Authorization: `Bearer ${jwt.sign({ sub: userId, purpose: 'access' }, process.env.JWT_SECRET)}` });

test('DELETE HTTP route requires authentication and ownership, then returns success', async () => {
  assert.equal((await fetch(url, { method: 'DELETE' })).status, 401);
  assert.equal((await fetch(url, { method: 'DELETE', headers: headers(otherUserId) })).status, 404);
  assert.ok(calls.every(([name]) => name === 'select'));
  const response = await fetch(url, { method: 'DELETE', headers: headers(ownerId) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).live_stream_id, liveStreamId);
  assert.equal(row, null);
  assert.equal((await fetch(url, { method: 'DELETE', headers: headers(ownerId) })).status, 404);
});
