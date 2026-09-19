import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, before, beforeEach, mock, test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';

const userId = '12345678-1234-4234-8234-123456789def';
const videoId = '12345678-1234-4234-8234-123456789abc';
const body = { title: ' New post ', blocks: [{ type: 'text', content: { text: ' Hello ' } }] };
let calls, released, connections, permission, videoVisible, failTable, nextId;

async function query(sql, params) {
  calls.push({ sql, params });
  if (sql.includes('SELECT id, status, authz_version')) {
    return { rows: [{ id: userId, status: 'active', authz_version: 1 }] };
  }
  if (sql.includes('bool_or')) {
    return { rows: permission === 'none' ? [] : [{
      id: '1', key: 'posts.create', has_allow: permission === 'allow', has_deny: permission === 'deny',
    }] };
  }
  if (sql.includes('FROM user_roles ur')) {
    return { rows: [{ id: '1', name: 'Uploader', position: 3, is_owner: false }] };
  }
  if (sql.includes('FROM public.videos')) return { rows: videoVisible ? [{ id: videoId }] : [] };
  if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
  const table = /INSERT INTO public\.(\w+)/.exec(sql)?.[1];
  if (table === failTable) throw new Error('insert failed');
  const fields = {
    posts: ['user_id', 'title'],
    post_blocks: ['post_id', 'type', 'position', 'content'],
    poll_options: ['block_id', 'text', 'image_url'],
    questioner_options: ['block_id', 'text', 'image_url', 'is_correct'],
  }[table];
  assert.ok(fields, `Unexpected SQL: ${sql}`);
  const row = { id: `fixture-${nextId++}` };
  fields.forEach((field, index) => { row[field] = field === 'content' ? JSON.parse(params[index]) : params[index]; });
  if (table === 'posts') row.created_at = '2026-09-19T00:00:00.000Z';
  return { rows: [row] };
}

mock.module(new URL('../src/database/index.js', import.meta.url).href, {
  namedExports: { writePool: {
    query,
    async connect() { connections++; return { query, release() { released++; } }; },
  } },
});

const { createPostInternal: create } = await import('../src/modules/posts/handlers/createPost.js');
const { default: postsRoutes } = await import('../src/modules/posts/posts.routes.js');

beforeEach(() => {
  calls = []; released = 0; connections = 0; nextId = 1;
  permission = 'allow'; videoVisible = true; failTable = null;
});

test('creates all five block types in order with options and authenticated ownership', async () => {
  const post = await create({ ...body, blocks: [
    ...body.blocks,
    { type: 'image', content: { url: 'image.jpg' } },
    { type: 'video', content: { video_id: videoId } },
    { type: 'poll', content: { text: 'Choose one' }, options: [{ text: 'A' }, { text: 'B', image_url: 'b.jpg' }] },
    { type: 'questioner', content: { text: 'Which answer?' }, options: [{ text: 'A', is_correct: true }, { text: 'B' }] },
  ] }, userId);
  assert.equal(post.user_id, userId);
  assert.equal(post.title, 'New post');
  assert.deepEqual(post.blocks.map(block => block.type), ['text', 'image', 'video', 'poll', 'questioner']);
  assert.deepEqual(post.blocks.map(block => block.position), [0, 1, 2, 3, 4]);
  assert.ok(post.blocks.every(block => block.post_id === post.id));
  assert.deepEqual(post.blocks[0].content, { text: 'Hello' });
  for (const block of post.blocks.slice(3)) {
    assert.equal(block.options.length, 2);
    assert.ok(block.options.every(option => option.block_id === block.id));
  }
  assert.equal(post.blocks[3].options[0].image_url, null);
  assert.equal(post.blocks[3].options[1].image_url, 'b.jpg');
  assert.equal(post.blocks[4].options[0].is_correct, true);
  assert.equal(post.blocks[4].options[1].is_correct, false);
  assert.equal(calls[0].sql, 'BEGIN');
  assert.equal(calls.at(-1).sql, 'COMMIT');
  assert.equal(released, 1);
});

test('rejects malformed blocks, options and author spoofing before connecting', async () => {
  const poll = { type: 'poll', content: { text: 'Choose' }, options: [{ text: 'A' }, { text: 'B' }] };
  const invalidBlocks = [
    { type: 'unknown', content: {} },
    { type: 'text', content: { text: ' ' } },
    { type: 'text', content: { text: 'a'.repeat(10001) } },
    { type: 'text', content: [] },
    { type: 'image', content: { url: '' } },
    { type: 'video', content: { video_id: 'invalid' } },
    { ...body.blocks[0], position: -1 },
    { ...body.blocks[0], options: poll.options },
    { ...poll, options: [{ text: 'A' }] },
    { ...poll, options: Array(21).fill({ text: 'A' }) },
    { ...poll, options: [{ text: 'A', is_correct: true }, { text: 'B' }] },
    { ...poll, options: [{ text: ' ' }, { text: 'B' }] },
    { ...poll, options: [{ text: 'A', block_id: 'foreign' }, { text: 'B' }] },
    { ...poll, type: 'questioner' },
    { ...poll, type: 'questioner', options: [{ text: 'A', is_correct: 'true' }, { text: 'B' }] },
  ];
  for (const invalid of [
    undefined, null, {}, { ...body, user_id: userId }, { ...body, title: ' ' },
    { ...body, title: 'a'.repeat(256) }, { ...body, blocks: [] },
    { ...body, blocks: Array(51).fill(body.blocks[0]) },
    ...invalidBlocks.map(block => ({ ...body, blocks: [block] })),
  ]) await assert.rejects(create(invalid, userId), { status: 400 });
  assert.equal(connections, 0);
  assert.deepEqual(calls, []);
});

test('requires an authenticated author before database access', async () => {
  await assert.rejects(create(body), { status: 401 });
  assert.equal(connections, 0);
});

test('missing or inaccessible embedded videos roll back without creating a post', async () => {
  videoVisible = false;
  await assert.rejects(create({ ...body, blocks: [{ type: 'video', content: { video_id: videoId } }] }, userId), { status: 404 });
  assert.equal(calls.some(call => call.sql.includes('INSERT')), false);
  assert.deepEqual(calls.find(call => call.sql.includes('FROM public.videos')).params, [videoId, userId]);
  assert.equal(calls.at(-1).sql, 'ROLLBACK');
  assert.equal(released, 1);
});

test('failures at every insert stage roll back and release the connection', async () => {
  for (const table of ['posts', 'post_blocks', 'poll_options', 'questioner_options']) {
    calls = []; released = 0; failTable = table;
    await assert.rejects(create({ ...body, blocks: [
      { type: 'poll', content: { text: 'Choose' }, options: [{ text: 'A' }, { text: 'B' }] },
      { type: 'questioner', content: { text: 'Choose' }, options: [{ text: 'A', is_correct: true }, { text: 'B' }] },
    ] }, userId), /insert failed/);
    assert.equal(calls.at(-1).sql, 'ROLLBACK');
    assert.equal(calls.some(call => call.sql === 'COMMIT'), false);
    assert.equal(released, 1);
  }
});

let server, baseUrl, token;
before(async () => {
  process.env.JWT_SECRET = 'posts-test-secret';
  token = jwt.sign({ sub: userId, authzVersion: 1 }, process.env.JWT_SECRET);
  const app = express();
  app.use(express.json());
  app.use('/api/posts', postsRoutes);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}/api/posts`;
});
after(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

function request(payload = body, authenticated = true) {
  return fetch(baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(payload),
  });
}

test('HTTP creation requires login and posts.create, including explicit denial', async () => {
  const unauthenticated = await request(body, false);
  assert.equal(unauthenticated.status, 401);
  await unauthenticated.json();
  for (const effect of ['none', 'deny']) {
    permission = effect;
    const response = await request();
    assert.equal(response.status, 403);
    assert.equal((await response.json()).requiredPermission, 'posts.create');
  }
  assert.equal(connections, 0);
});

test('HTTP creation returns 201 and the persisted post in the shared envelope', async () => {
  const response = await request();
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.success, true);
  assert.equal(result.post.user_id, userId);
  assert.equal(result.post.title, 'New post');
  assert.equal(result.post.blocks[0].position, 0);
  assert.deepEqual(result.post.blocks[0].content, { text: 'Hello' });
  assert.equal(released, 1);
});

test('HTTP invalid input uses the shared 400 error envelope', async () => {
  const response = await request({ ...body, user_id: videoId });
  assert.equal(response.status, 400);
  const result = await response.json();
  assert.equal(result.success, false);
  assert.ok(result.message);
  assert.equal(connections, 0);
});
