import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

test('MCP discovers and calls all eight authenticated AI routes', async t => {
  const id = randomUUID();
  const token = randomUUID();
  const progressToken = randomUUID();
  process.env.DATABASE_URL = 'postgres://test:test@127.0.0.1:1/test';
  process.env.AI_TOOLS_BEARER_TOKEN = token;
  process.env.AI_CHATBOT_PLATFORM_BEARER_TOKEN = progressToken;
  process.env.OPENAI_API_KEY = 'test';
  const { readPool, writePool } = await import('../src/database/index.js');
  const source = { video_id: id, text: 'Example', start_seconds: 12, end_seconds: 15,
    document_type: 'transcript_chunk', language: 'sr', metadata: {} };
  t.mock.method(readPool, 'query', async (sql, values) => {
    if (sql.includes('FROM public.people') && values[0] === id) return { rows: [{ id, name: 'Ana' }] };
    if (sql.includes('END AS is_saved')) return { rows: [{ id, title: 'Playlist' }] };
    return { rows: [] };
  });
  t.mock.method(writePool, 'query', async (sql, values) => {
    if (sql.includes('u.id as uploader_id')) return { rows: [{ id, title: 'Video' }] };
    if (sql.includes('COUNT(DISTINCT v.id) AS total')) return { rows: [{ total: 0 }] };
    if (sql.includes('WITH candidates AS')) {
      assert.deepEqual(values[0], [id]);
      assert.equal(values[3], 'second_half');
      assert.deepEqual(values.slice(5), ['sr', 'transcript_chunk']);
      return { rows: [source] };
    }
    return { rows: [] };
  });
  t.mock.method(writePool, 'connect', () => assert.fail('A bot lookup attempted to record a view'));
  const http = globalThis.fetch;
  const progressRequests = [];
  let progressResponse = () => Response.json({ ok: true });
  t.mock.method(globalThis, 'fetch', (url, options) => {
    if (String(url) === 'https://ai-chatbot-platform.fly.dev/api/webhooks/n8n/progress') {
      progressRequests.push(options);
      return progressResponse();
    }
    if (String(url) === 'https://api.openai.com/v1/embeddings') {
      return Response.json({ data: [{ index: 0, embedding: Array(1536).fill(0.1) }] });
    }
    if (url instanceof URL && url.pathname.startsWith('/api/ai/') && url.pathname !== '/api/ai/mcp') {
      const body = options?.body ? JSON.parse(options.body) : {};
      for (const key of ['step', 'session_id', 'site_domain']) {
        assert.equal(url.searchParams.has(key), false);
        assert.equal(Object.hasOwn(body, key), false);
      }
    }
    return http(url, options);
  });
  const { createApp } = await import('../src/app.js');
  const listener = createApp().listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const url = new URL(`http://127.0.0.1:${listener.address().port}/api/ai/mcp`);
  url.searchParams.set('session_id', randomUUID());
  url.searchParams.set('site_domain', 'video.example');
  const headers = { Authorization: `Bearer ${token}` };
  const client = new Client({ name: 'test-bot', version: '1' });
  t.after(async () => {
    await client.close();
    await new Promise(resolve => listener.close(resolve));
  });

  for (const auth of [{}, { Authorization: 'Bearer wrong' }]) {
    assert.equal((await http(url, { method: 'POST', headers: auth })).status, 401);
  }
  assert.equal((await http(url, { method: 'POST', headers: { ...headers, Origin: 'https://invalid.example' } })).status, 403);
  assert.equal((await http(url, { headers })).status, 405);
  await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers } }));

  const cases = [
    ['search_videos', { q: 'surgery', page: 2, limit: 5 }, result => assert.equal(result.pagination.page, 2)],
    ['get_video', { id }, result => assert.deepEqual([result.id, result.view.counted], [id, false])],
    ['get_video_chat_sources', { video_ids: [id], question: 'Explain this part', section: 'second_half',
      mode: 'summary', language: 'sr', document_type: 'transcript_chunk' }, result => assert.deepEqual(result.sources, [source])],
    ['search_playlists', { tags: 'one,two', limit: 8 }, result => assert.equal(result.pagination.limit, 8)],
    ['get_playlist', { id }, result => assert.deepEqual([result.playlist.id, result.view.counted], [id, false])],
    ['get_playlist_videos', { id, sortBy: 'view_count', sortOrder: 'desc' },
      result => assert.deepEqual(result.sorting, { sortBy: 'view_count', sortOrder: 'desc' })],
    ['search_people', { q: 'Ana', limit: 3 }, result => assert.equal(result.pagination.limit, 3)],
    ['get_person', { id }, result => assert.deepEqual(result.person, { id, name: 'Ana' })],
  ];
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name).sort(), cases.map(([name]) => name).sort());
  for (const tool of tools) {
    assert.equal(tool.inputSchema.properties.step.type, 'string');
    assert.ok(!tool.inputSchema.required?.includes('step'));
  }
  for (const [name, args, verify] of cases) {
    const result = await client.callTool({ name, arguments: { ...args, step: 'Preparing the response' } });
    assert.ok(!result.isError, JSON.stringify(result.content));
    assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
    verify(result.structuredContent);
  }
  assert.equal(progressRequests.length, cases.length);
  for (const request of progressRequests) {
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.Authorization, `Bearer ${progressToken}`);
    assert.equal(request.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(request.body), {
      session_id: url.searchParams.get('session_id'), step: 'Preparing the response', site_domain: 'video.example',
    });
  }
  for (const search of ['', '?session_id=example', '?site_domain=video.example', url.search]) {
    const endpoint = new URL(url);
    endpoint.search = search;
    const response = await http(endpoint, {
      method: 'POST',
      headers: { ...headers, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'get_person', arguments: search === url.search ? { id } : { id, step: 'Finding the speaker' } },
      }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).result.structuredContent.person.id, id);
  }
  const invalid = await client.callTool({ name: 'get_person', arguments: { id: 'invalid' } });
  assert.equal(invalid.isError, true);
  const missing = await client.callTool({ name: 'get_person', arguments: { id: randomUUID() } });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /404/);
  assert.equal(progressRequests.length, cases.length);

  const lookup = { name: 'get_person', arguments: { id, step: 'Finding the speaker' } };
  progressResponse = () => new Response(null, { status: 401 });
  assert.equal((await client.callTool(lookup)).structuredContent.person.id, id);
  progressResponse = () => { throw new Error('Network unavailable'); };
  assert.equal((await client.callTool(lookup)).structuredContent.person.id, id);
  delete process.env.AI_CHATBOT_PLATFORM_BEARER_TOKEN;
  assert.equal((await client.callTool(lookup)).structuredContent.person.id, id);
  assert.equal(progressRequests.length, cases.length + 2);
});
