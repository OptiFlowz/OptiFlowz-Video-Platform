import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import Mux from '@mux/mux-node';

// Exercise the installed SDK and its HTTP parsing, not a fake async iterator.
// The transport is local: these tests never contact Mux or use real credentials.
let requests, databaseDeleted, pages, assetDeleteStatus;
const mux = new Mux({
  tokenId: 'test-id', tokenSecret: 'test-secret',
  async fetch(input, options) {
    const url = new URL(input);
    requests.push({ method: options.method, path: url.pathname, query: Object.fromEntries(url.searchParams) });
    if (requests.length > 10) throw new Error('Unbounded pagination');
    if (options.method === 'GET' && url.pathname.endsWith('/live-streams/live-id')) {
      return Response.json({ data: { id: 'live-id', status: 'disabled', recent_asset_ids: ['recording'] } });
    }
    if (options.method === 'GET' && url.pathname.endsWith('/assets')) {
      // Reproduce Mux ignoring numeric `page`: without a cursor this always
      // returns the same nonempty first page, even for page=2, page=3, etc.
      const page = pages[url.searchParams.get('cursor') ?? 'first'];
      assert.ok(page, 'only a next_cursor returned by Mux may be requested');
      return Response.json(page);
    }
    if (options.method === 'PUT' && url.pathname.endsWith('/disable')) {
      return Response.json({ data: {} });
    }
    if (options.method === 'DELETE') {
      if (url.pathname.includes('/assets/') && assetDeleteStatus !== 204) {
        return Response.json({ error: { type: 'not_found', messages: ['Missing asset'] } }, { status: assetDeleteStatus });
      }
      // Empty 204 response acknowledges the request. No deletion webhook is
      // delivered and the list response still contains the asset afterward.
      return new Response(null, { status: 204 });
    }
    throw new Error('Unexpected request');
  },
});
mock.module('@mux/mux-node', { defaultExport: class { constructor() { return mux; } } });
mock.module(new URL('../src/database/index.js', import.meta.url).href, {
  namedExports: { writePool: { async connect() {
    const pool = this;
    return { release() {}, async query(sql) {
      if (sql.startsWith('SELECT id, thumbnail_url') || ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
      return pool.query(sql);
    } };
  }, async query(sql) {
    if (sql.startsWith('DELETE')) {
      databaseDeleted = true;
      return { rows: [] };
    }
    return { rows: [{ video_id: 'video-id', live_stream_id: 'local-live-id', mux_live_stream_id: 'live-id', mux_asset_id: 'recording', mux_asset_ids: ['recording'] }] };
  } } },
});
const { deleteVideoResources } = await import('../src/modules/videos/helpers/deleteVideoResources.js');
beforeEach(() => {
  requests = []; databaseDeleted = false; assetDeleteStatus = 204;
  pages = { first: { data: [{ id: 'recording' }], next_cursor: null } };
});

test('a nonempty final page stops pagination and empty 204 responses finish deletion without webhooks', async () => {
  await deleteVideoResources({ liveStreamId: 'local-live-id', ownerId: 'owner' });
  const listRequests = requests.filter(r => r.path.endsWith('/assets'));
  assert.equal(listRequests.length, 1);
  assert.deepEqual(listRequests[0].query, { live_stream_id: 'live-id', limit: '100' });
  assert.equal(requests.filter(r => r.method === 'DELETE').length, 2);
  assert.equal(databaseDeleted, true);
});

test('cursor pagination collects all recordings before deletion without numeric page requests', async () => {
  pages.first.next_cursor = 'next-recordings';
  pages['next-recordings'] = { data: [{ id: 'other-recording' }], next_cursor: null };
  await deleteVideoResources({ liveStreamId: 'local-live-id', ownerId: 'owner' });
  const listRequests = requests.filter(r => r.path.endsWith('/assets'));
  assert.equal(listRequests.length, 2);
  assert.deepEqual(listRequests[1].query, { live_stream_id: 'live-id', limit: '100', cursor: 'next-recordings' });
  const firstDelete = requests.findIndex(r => r.method === 'DELETE');
  assert.ok(requests.indexOf(listRequests[1]) < firstDelete);
  assert.deepEqual(requests.filter(r => r.method === 'DELETE').map(r => r.path), [
    '/video/v1/assets/recording', '/video/v1/assets/other-recording', '/video/v1/live-streams/live-id',
  ]);
  assert.equal(databaseDeleted, true);
});

test('repeated cursors fail promptly and preserve database records', async t => {
  t.mock.method(console, 'error', () => {});
  pages.first.next_cursor = 'repeated';
  pages.repeated = { data: [{ id: 'recording' }], next_cursor: 'repeated' };
  await assert.rejects(deleteVideoResources({ liveStreamId: 'local-live-id', ownerId: 'owner' }), { status: 502 });
  assert.equal(requests.filter(r => r.path.endsWith('/assets')).length, 2);
  assert.ok(!requests.some(r => r.method === 'DELETE'));
  assert.equal(databaseDeleted, false);
});

test('an actual SDK 404 error for an already deleted asset still permits local cleanup', async () => {
  pages.first = { data: [], next_cursor: null };
  assetDeleteStatus = 404;
  await deleteVideoResources({ liveStreamId: 'local-live-id', ownerId: 'owner' });
  assert.equal(databaseDeleted, true);
});
