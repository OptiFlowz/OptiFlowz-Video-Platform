import assert from 'node:assert/strict';
import { after, before, beforeEach, mock, test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';

const ownerId = '12345678-1234-4234-8234-123456789abc';
const otherUserId = '12345678-1234-4234-8234-123456789def';
const liveStreamId = '12345678-1234-4234-8234-123456789012';
let calls, row, stream, failure;
mock.module(new URL('../src/database/index.js', import.meta.url).href, {
  namedExports: { writePool: { async query(sql, values) {
    if (sql.includes('FROM users')) {
      return { rows: [{ id: values[0], status: 'active', authz_version: 1 }] };
    }
    calls.push(['query', sql, values]);
    assert.match(sql, /WHERE ls.id = \$1 AND ls.user_id = \$2/);
    return { rows: row && values[0] === liveStreamId && values[1] === ownerId ? [row] : [] };
  } } },
});
mock.module('@mux/mux-node', {
  defaultExport: class {
    video = { liveStreams: { async retrieve(id) {
      calls.push(['retrieve', id]);
      if (failure) throw Object.assign(new Error('Upstream error with private credentials'), { status: failure });
      return stream;
    } } };
  },
});
const { getStreamingDetailsInternal: details } = await import('../src/modules/live-streams/handlers/getStreamingDetails.js');
const { default: router } = await import('../src/modules/live-streams/live-streams.routes.js');
beforeEach(() => {
  calls = []; failure = null;
  row = { status: 'scheduled', mux_live_stream_id: 'mux-live-id' };
  stream = { status: 'idle', stream_key: 'encoder-key' };
});

test('the owner receives only the RTMPS server and current Mux stream key', async () => {
  assert.deepEqual(await details(liveStreamId, ownerId), {
    server: 'rtmps://global-live.mux.com:443/app', stream_key: 'encoder-key',
  });
  assert.equal(calls[0][0], 'query');
  assert.deepEqual(calls[0][2], [liveStreamId, ownerId]);
  assert.deepEqual(calls[1], ['retrieve', 'mux-live-id']);
  stream.stream_key = 'rotated-encoder-key';
  row.status = 'live'; stream.status = 'active';
  assert.equal((await details(liveStreamId, ownerId)).stream_key, 'rotated-encoder-key');
});

test('unauthenticated users and invalid IDs fail before database or Mux access', async () => {
  await assert.rejects(details(liveStreamId, null), { status: 401 });
  for (const id of ['mux-live-id', '', undefined]) await assert.rejects(details(id, ownerId), { status: 400 });
  assert.deepEqual(calls, []);
});

test('another user or missing stream receives 404 without a Mux lookup', async () => {
  await assert.rejects(details(liveStreamId, otherUserId), { status: 404 });
  row = null;
  await assert.rejects(details(liveStreamId, ownerId), { status: 404 });
  assert.ok(calls.every(([name]) => name === 'query'));
});

test('ended and cancelled application events cannot reuse encoder credentials', async () => {
  for (const status of ['ended', 'cancelled']) {
    row.status = status;
    await assert.rejects(details(liveStreamId, ownerId), { status: 409 });
  }
  assert.ok(calls.every(([name]) => name === 'query'));
});

test('disconnected and scheduled streams can retrieve credentials without any recordings', async () => {
  for (const status of ['disconnected', 'scheduled']) {
    row.status = status;
    stream.status = status === 'disconnected' ? 'active' : 'idle';
    assert.equal((await details(liveStreamId, ownerId)).stream_key, 'encoder-key');
  }
});

test('disabled streams and incomplete Mux responses produce useful errors', async () => {
  stream.status = 'disabled';
  await assert.rejects(details(liveStreamId, ownerId), { status: 409 });
  stream.status = 'idle';
  for (const key of [undefined, null, '', '   ']) {
    stream.stream_key = key;
    await assert.rejects(details(liveStreamId, ownerId), { status: 502 });
  }
});

test('Mux failures never expose the upstream error payload', async () => {
  failure = 404;
  await assert.rejects(details(liveStreamId, ownerId), { status: 404, message: 'Mux live stream not found' });
  failure = 500;
  await assert.rejects(details(liveStreamId, ownerId), { status: 502, message: 'Unable to retrieve streaming details' });
});

let server, url, previousSecret;
before(async () => {
  previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'streaming-details-test-secret';
  const app = express();
  app.use('/api/live-streams', router);
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  url = `http://127.0.0.1:${server.address().port}/api/live-streams/${liveStreamId}/streaming-details`;
});
after(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});
const headers = userId => ({ Authorization: `Bearer ${jwt.sign({ sub: userId, purpose: 'access' }, process.env.JWT_SECRET)}` });

test('HTTP route requires authentication and restricts access to the owner', async () => {
  assert.equal((await fetch(url)).status, 401);
  const denied = await fetch(url, { headers: headers(otherUserId) });
  assert.equal(denied.status, 404);
  assert.equal((await denied.json()).stream_key, undefined);
  assert.ok(!calls.some(([name]) => name === 'retrieve'));
});

test('HTTP route returns non-cacheable streaming credentials', async () => {
  const response = await fetch(url, { headers: headers(ownerId) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await response.json(), {
    success: true, server: 'rtmps://global-live.mux.com:443/app', stream_key: 'encoder-key',
  });
});
