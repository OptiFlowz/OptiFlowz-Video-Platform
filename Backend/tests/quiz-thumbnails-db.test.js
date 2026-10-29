import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { mock, test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import sharp from 'sharp';
import { installQuizPermissions } from './helpers/quiz-permissions-schema.js';
import { upgradeQuizCertificates } from './helpers/quiz-certificate-schema.js';

test('quiz thumbnails: migration, HTTP authorization, image processing and transactional cleanup', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const schema = `quiz_thumbnail_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL, statement_timeout: 10000 });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}; SET search_path TO ${schema},public`);
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 5,
    statement_timeout: 10000, options: `-c search_path=${schema},public` });
  t.after(async () => {
    await pool.end();
    try { await admin.query(`DROP SCHEMA ${schema} CASCADE`); } finally { await admin.end(); }
  });
  await admin.query("CREATE TABLE users(id uuid PRIMARY KEY,status text DEFAULT 'active',authz_version integer DEFAULT 1)");
  for (const name of ['1791590400004_add-quizzes.sql', '1792195200000_add-quiz-feedback-and-scoring-settings.sql', '1792627200001_add-quiz-questions-per-page.sql']) {
    const sql = await readFile(new URL(`../src/database/migrations/${name}`, import.meta.url), 'utf8');
    await admin.query(sql.split('-- Down Migration')[0].replaceAll('public.', `${schema}.`));
  }
  await upgradeQuizCertificates(admin, { schema });
  await installQuizPermissions(admin, { schema, defaultRole: null });
  const owner = randomUUID(), other = randomUUID(), viewer = randomUUID(), administrator = randomUUID(), globalOwner = randomUUID();
  for (const [id, role] of [[owner, 'Uploader'], [other, 'Uploader'], [viewer, 'Viewer'], [administrator, 'Administrator'], [globalOwner, 'Owner']]) {
    await admin.query('INSERT INTO users(id) VALUES($1)', [id]);
    await admin.query('INSERT INTO user_roles SELECT $1,id,NULL FROM roles WHERE name=$2', [id, role]);
  }
  const quizId = randomUUID();
  await admin.query("INSERT INTO quizzes(id,user_id,title,status,question_count) VALUES($1,$2,'Quiz','published',1)", [quizId, owner]);
  const migration = (await readFile(new URL('../src/database/migrations/1793232000001_add-quiz-thumbnail.sql', import.meta.url), 'utf8'))
    .replaceAll('public.', `${schema}.`).split('-- Down Migration');
  await t.test('migration preserves existing quizzes, defaults to null and rolls back', async () => {
    const before = (await admin.query('SELECT * FROM quizzes WHERE id=$1', [quizId])).rows[0];
    await admin.query(migration[0]);
    assert.deepEqual((await admin.query('SELECT * FROM quizzes WHERE id=$1', [quizId])).rows[0], { ...before, thumbnail_url: null });
    await admin.query(migration[1]);
    assert.deepEqual((await admin.query('SELECT * FROM quizzes WHERE id=$1', [quizId])).rows[0], before);
    await admin.query(migration[0]);
  });
  const base = 'https://cdn.example.test', oldKey = `quiz-thumbnails/${quizId}/old.webp`;
  const previous = Object.fromEntries(['R2_PUBLIC_BASE_URL', 'R2_BUCKET', 'JWT_SECRET'].map(key => [key, process.env[key]]));
  Object.assign(process.env, { R2_PUBLIC_BASE_URL: `${base}/`, R2_BUCKET: 'test-bucket', JWT_SECRET: 'quiz-thumbnail-test' });
  t.after(() => { for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
  let commands = [], objects = new Map(), failPut = false, failUpdate = false, failCommit = false, failDelete = false;
  const queryOn = database => async (sql, params) => {
    if (failUpdate && sql.includes('UPDATE public.quizzes SET thumbnail_url')) throw new Error('Injected update failure');
    const result = await database.query(sql.replaceAll('public.', `${schema}.`), params);
    if (failCommit && sql === 'COMMIT') throw new Error('Lost commit response');
    return result;
  };
  mock.module(new URL('../src/database/index.js', import.meta.url).href, { namedExports: { writePool: {
    query: queryOn(pool), async connect() { const client = await pool.connect(); return { query: queryOn(client), release: () => client.release() }; },
  } } });
  mock.module(new URL('../src/modules/storage/r2.client.js', import.meta.url).href, { namedExports: { s3: {
    async send(command) {
      commands.push(command);
      const { Key, Body } = command.input;
      if (command.constructor.name === 'PutObjectCommand') {
        objects.set(Key, Body);
        if (failPut) throw new Error('Injected storage failure');
      } else {
        assert.equal(command.constructor.name, 'DeleteObjectCommand');
        if (failDelete) throw new Error('Injected cleanup failure');
        objects.delete(Key);
      }
    },
  } } });
  const { default: router } = await import('../src/modules/quizzes-engine/quizzes/quizzes.routes.js');
  const { quizThumbnailUploadInternal: upload } = await import('../src/modules/quizzes-engine/quizzes/handlers/quizThumbnailUpload.js');
  const app = express(); app.use(express.json()); app.use('/api/quizzes', router);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const params = { quizId };
  const buffer = await sharp({ create: { width: 20, height: 40, channels: 3, background: '#ff0000' } }).png().toBuffer();
  const file = { buffer, size: buffer.length, mimetype: 'image/png' };
  const multipart = (data = buffer, type = 'image/png', key = 'file') => {
    const form = new FormData(); form.append(key, new Blob([data], { type }), 'image.png'); return form;
  };
  const request = async (actor, method, path, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/quizzes${path}`, {
      method, headers: actor ? { Authorization: `Bearer ${jwt.sign({ sub: actor, authzVersion: 1 }, process.env.JWT_SECRET)}` } : {}, body,
    });
    return { status: response.status, body: await response.json() };
  };
  const stored = async () => (await admin.query('SELECT * FROM quizzes WHERE id=$1', [quizId])).rows[0];
  async function reset() {
    commands = []; objects = new Map([[oldKey, Buffer.from('old')]]);
    failPut = false; failUpdate = false; failCommit = false; failDelete = false;
    await admin.query("UPDATE quizzes SET thumbnail_url=$2,updated_at='2026-01-01' WHERE id=$1", [quizId, `${base}/${oldKey}`]);
  }
  await t.test('auth, update-own scope, UUIDs and missing quizzes block uploads before storage', async () => {
    await reset();
    for (const [actor, id, expected] of [[null, quizId, 401], [viewer, quizId, 403], [other, quizId, 404], [owner, randomUUID(), 404], [owner, 'bad', 400]]) {
      assert.equal((await request(actor, 'POST', `/${id}/thumbnail`, multipart())).status, expected);
    }
    await assert.rejects(upload({ params, file }), { status: 401 });
    await assert.rejects(upload({ params, file }, other), { status: 404 });
    assert.equal(commands.length, 0);
    assert.equal((await stored()).thumbnail_url, `${base}/${oldKey}`);
  });
  await t.test('PNG/JPEG/WebP uploads use canonical keys, exact sizing, own/any permissions and visible URLs', async () => {
    for (const [format, actor] of [['png', owner], ['jpeg', administrator], ['webp', globalOwner]]) {
      await reset();
      const data = await sharp(buffer).toFormat(format).toBuffer();
      const response = await request(actor, 'POST', `/${quizId.toUpperCase()}/thumbnail`, multipart(data, `image/${format}`));
      assert.equal(response.status, 200);
      const put = commands[0].input;
      assert.equal(put.ContentType, 'image/webp'); assert.equal(put.Bucket, 'test-bucket');
      assert.equal(put.CacheControl, 'public, max-age=31536000, immutable');
      assert.ok(put.Key.startsWith(`quiz-thumbnails/${quizId}/`));
      assert.deepEqual(response.body, { success: true, quiz: { id: quizId, thumbnail_url: `${base}/${put.Key}` } });
      const metadata = await sharp(put.Body).metadata();
      assert.equal(metadata.format, 'webp'); assert.equal(metadata.width, 1280); assert.equal(metadata.height, 720);
      assert.equal(objects.has(oldKey), false); assert.equal(objects.size, 1);
      const row = await stored();
      assert.equal(row.user_id, owner); assert.ok(row.updated_at > new Date('2026-01-01'));
      for (const [path, user] of [[`/${quizId}`, owner], ['', owner], [`/published/${quizId}`, viewer], ['/published', viewer]]) {
        const read = await request(user, 'GET', path);
        assert.equal(read.status, 200);
        assert.equal((read.body.quiz ?? read.body.quizzes[0]).thumbnail_url, row.thumbnail_url);
      }
    }
  });
  await t.test('empty POST removes the thumbnail and is repeatable; other resource/external files stay untouched', async () => {
    await reset();
    const result = await request(owner, 'POST', `/${quizId}/thumbnail`);
    assert.equal(result.status, 200); assert.equal(result.body.quiz.thumbnail_url, null);
    assert.equal(objects.size, 0); assert.equal((await stored()).thumbnail_url, null);
    assert.equal((await request(owner, 'POST', `/${quizId}/thumbnail`)).status, 200);
    assert.equal(commands.length, 1);
    commands = [];
    for (const url of [`${base}/video-thumbnails/other/image.webp`, `${base}.evil.test/${oldKey}`, `${base}/quiz-thumbnails/${randomUUID()}/image.webp`]) {
      await admin.query('UPDATE quizzes SET thumbnail_url=$2 WHERE id=$1', [quizId, url]);
      assert.equal((await upload({ params }, owner)).thumbnail_url, null);
    }
    assert.equal(commands.length, 0);
  });
  await t.test('bad image data, type, size and upload field return 400 without modifying the current image', async () => {
    await reset();
    for (const form of [multipart(buffer, 'image/gif'), multipart(Buffer.from('corrupt')), multipart(buffer, 'image/png', 'thumbnail'),
      multipart(new Uint8Array(5 * 1024 * 1024 + 1))]) {
      assert.equal((await request(owner, 'POST', `/${quizId}/thumbnail`, form)).status, 400);
    }
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"></svg>');
    await assert.rejects(upload({ params, file: { buffer: svg, size: svg.length, mimetype: 'image/png' } }, owner), { status: 400 });
    assert.equal(commands.length, 0); assert.equal((await stored()).thumbnail_url, `${base}/${oldKey}`);
  });
  await t.test('upload/database failures roll back and remove only the newly allocated object', async () => {
    for (const failure of ['put', 'update']) {
      await reset(); failPut = failure === 'put'; failUpdate = failure === 'update';
      await assert.rejects(upload({ params, file }, owner));
      assert.equal((await stored()).thumbnail_url, `${base}/${oldKey}`);
      assert.deepEqual([...objects.keys()], [oldKey]);
      assert.equal(commands[1].input.Key, commands[0].input.Key);
    }
  });
  await t.test('lost commit response retains referenced files; cleanup failures do not undo committed upload', async () => {
    await reset(); failCommit = true;
    await assert.rejects(upload({ params, file }, owner));
    assert.equal((await stored()).thumbnail_url, `${base}/${commands[0].input.Key}`);
    assert.equal(objects.size, 2); assert.equal(commands.length, 1);
    await reset(); failDelete = true;
    const warn = mock.method(console, 'warn', () => {});
    try {
      const result = await upload({ params, file }, owner);
      assert.equal(result.thumbnail_url, (await stored()).thumbnail_url);
      assert.equal(objects.size, 2);
    } finally { warn.mock.restore(); }
  });
  await t.test('concurrent replacements serialize and retain only the final referenced image', async () => {
    await reset();
    await Promise.all([upload({ params, file }, owner), upload({ params, file }, owner)]);
    assert.equal(objects.size, 1);
    assert.equal((await stored()).thumbnail_url, `${base}/${[...objects.keys()][0]}`);
  });
});
