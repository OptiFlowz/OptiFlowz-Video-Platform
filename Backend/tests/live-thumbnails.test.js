import assert from 'node:assert/strict';
import { after, before, beforeEach, mock, test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import sharp from 'sharp';

const id = '12345678-1234-4234-8234-123456789012';
const owner = '12345678-1234-4234-8234-123456789abc';
const stranger = '12345678-1234-4234-8234-123456789def';
const base = 'https://r2.example.test';
let row, snapshot, commands, queries, failUpdate, failPut;
const previous = Object.fromEntries(['R2_PUBLIC_BASE_URL', 'R2_BUCKET', 'JWT_SECRET'].map(k => [k, process.env[k]]));
Object.assign(process.env, { R2_PUBLIC_BASE_URL: base, R2_BUCKET: 'test-bucket', JWT_SECRET: 'live-thumbnail-test' });
after(() => { for (const [key, value] of Object.entries(previous)) {
  if (value === undefined) delete process.env[key]; else process.env[key] = value;
} });
const client = {
  release() {},
  async query(sql, params) {
    queries.push(sql);
    if (sql === 'BEGIN') snapshot = structuredClone(row);
    if (sql === 'ROLLBACK') row = snapshot;
    if (sql.includes('SELECT thumbnail_url')) {
      assert.match(sql, /user_id=\$2 FOR UPDATE/);
      return { rows: row && params[0] === id && params[1] === owner ? [structuredClone(row)] : [] };
    }
    if (sql.includes('UPDATE public.live_streams')) {
      if (failUpdate) throw new Error('Injected update failure');
      row.thumbnail_url = params[1];
      return { rows: [structuredClone(row)] };
    }
    return { rows: [] };
  },
};
mock.module(new URL('../src/database/index.js', import.meta.url).href, { namedExports: { writePool: {
  async connect() { return client; },
  async query() { return { rows: [{ id: owner, status: 'active', authz_version: 1 }] }; },
} } });
mock.module(new URL('../src/modules/storage/r2.client.js', import.meta.url).href, { namedExports: { s3: {
  async send(command) {
    commands.push(command);
    if (failPut && command.constructor.name === 'PutObjectCommand') throw new Error('Injected storage failure');
  },
} } });
// The router imports the other handlers too; no Mux request is needed here.
mock.module('@mux/mux-node', { defaultExport: class {} });
const { liveThumbnailUploadInternal: upload } = await import('../src/modules/live-streams/handlers/liveThumbnailUpload.js');
const { default: router } = await import('../src/modules/live-streams/live-streams.routes.js');
const params = { liveStreamId: id };
let file, server, url;
before(async () => {
  const buffer = await sharp({ create: { width: 20, height: 40, channels: 3, background: '#ff0000' } }).png().toBuffer();
  file = { buffer, size: buffer.length, mimetype: 'image/png' };
  const app = express();
  app.use('/api/live-streams', router);
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  url = `http://127.0.0.1:${server.address().port}/api/live-streams/${id}/thumbnail`;
});
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); });
beforeEach(() => {
  row = { id, thumbnail_url: `${base}/live-stream-thumbnails/${id}/old.webp` };
  commands = []; queries = []; failUpdate = false; failPut = false;
});

test('upload converts the image, saves its own URL, then removes the replaced live thumbnail', async () => {
  const result = await upload({ params, file }, owner);
  assert.equal(result.live_stream.thumbnail_url, `${base}/${commands[0].input.Key}`);
  assert.ok(commands[0].input.Key.startsWith(`live-stream-thumbnails/${id}/`));
  assert.equal(commands[0].input.ContentType, 'image/webp');
  const metadata = await sharp(commands[0].input.Body).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, 1280);
  assert.equal(metadata.height, 720);
  assert.equal(commands[1].constructor.name, 'DeleteObjectCommand');
  assert.equal(commands[1].input.Key, `live-stream-thumbnails/${id}/old.webp`);
  assert.ok(queries.includes('COMMIT'));
});

test('omitting the file clears the thumbnail and deletes the R2 object', async () => {
  assert.equal((await upload({ params }, owner)).live_stream.thumbnail_url, null);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].constructor.name, 'DeleteObjectCommand');
});

test('authentication, ownership and UUID checks prevent writes', async () => {
  await assert.rejects(upload({ params, file }), { status: 401 });
  await assert.rejects(upload({ params: { liveStreamId: 'invalid' }, file }, owner), { status: 400 });
  await assert.rejects(upload({ params, file }, stranger), { status: 404 });
  assert.equal(commands.length, 0);
  assert.ok(!queries.some(q => q.includes('UPDATE public.live_streams')));
});

test('invalid type, oversized files and corrupt images are rejected', async () => {
  for (const invalid of [
    { ...file, mimetype: 'image/gif' }, { ...file, size: 5 * 1024 * 1024 + 1 },
    { ...file, buffer: Buffer.from('not an image') },
  ]) await assert.rejects(upload({ params, file: invalid }, owner), { status: 400 });
  assert.equal(commands.length, 0);
});

test('failed upload or database write preserves the old thumbnail and cleans the new key', async () => {
  for (const failure of ['upload', 'database']) {
    const oldUrl = row.thumbnail_url;
    failPut = failure === 'upload'; failUpdate = failure === 'database'; commands = [];
    await assert.rejects(upload({ params, file }, owner));
    assert.equal(row.thumbnail_url, oldUrl);
    assert.equal(commands.at(-1).constructor.name, 'DeleteObjectCommand');
    assert.equal(commands.at(-1).input.Key, commands[0].input.Key);
  }
});

test('thumbnail cleanup never deletes another resource or an external URL', async () => {
  for (const url of [`${base}/video-thumbnails/video/owned.webp`, `${base}.evil.test/live-stream-thumbnails/${id}/x.webp`]) {
    row.thumbnail_url = url;
    await upload({ params }, owner);
  }
  assert.equal(commands.length, 0);
});

test('HTTP route accepts multipart file uploads and empty requests for removal', async () => {
  assert.equal((await fetch(url, { method: 'POST' })).status, 401);
  const headers = { Authorization: `Bearer ${jwt.sign({ sub: owner, purpose: 'access' }, process.env.JWT_SECRET)}` };
  const form = new FormData();
  form.append('file', new Blob([file.buffer], { type: 'image/png' }), 'thumbnail.png');
  const response = await fetch(url, { method: 'POST', headers, body: form });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).live_stream.id, id);
  const removed = await fetch(url, { method: 'POST', headers });
  assert.equal(removed.status, 200);
  assert.equal((await removed.json()).live_stream.thumbnail_url, null);
  const oversized = new FormData();
  oversized.append('file', new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: 'image/png' }), 'large.png');
  assert.equal((await fetch(url, { method: 'POST', headers, body: oversized })).status, 400);
});
