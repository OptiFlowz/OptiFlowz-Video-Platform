import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { mock, test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import sharp from 'sharp';
import { errorHandler } from '../src/middleware/error-handler.js';

test('collection listing and management against isolated PostgreSQL schema', {
  skip: !process.env.TEST_DATABASE_URL,
}, async t => {
  // Separate connections exercise real transaction locks; all data lives in this disposable schema.
  const schema = `collections_test_${randomUUID().replaceAll('-', '')}`;
  const setup = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL, connectionTimeoutMillis: 5000 });
  await setup.connect();
  t.after(async () => {
    try { await setup.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
    finally { await setup.end(); }
  });
  await setup.query(`CREATE SCHEMA ${schema}; SET search_path TO ${schema};
    CREATE TABLE users (id uuid PRIMARY KEY, role text);
    CREATE TABLE playlists (id uuid PRIMARY KEY, created_by uuid REFERENCES users(id), status text NOT NULL,
      title text NOT NULL DEFAULT 'Playlist', thumbnail_url text, view_count integer NOT NULL DEFAULT 0,
      created_at timestamp NOT NULL DEFAULT now());
    CREATE TABLE videos (id uuid PRIMARY KEY, uploaded_by uuid REFERENCES users(id), thumbnail_url text,
      mux_status text, visibility text, published_at timestamptz, mux_playback_id text, playback_policy text,
      mux_thumbnail_time double precision, duration_seconds double precision);
    CREATE TABLE playlist_items (playlist_id uuid REFERENCES playlists(id) ON DELETE CASCADE,
      video_id uuid REFERENCES videos(id) ON DELETE CASCADE, position integer, PRIMARY KEY (playlist_id, video_id));`);
  const creator = randomUUID(), other = randomUUID(), admin = randomUUID(), viewer = randomUUID(), owner = randomUUID();
  for (const [id, role] of [[creator, 'uploader'], [other, 'uploader'], [admin, 'admin'], [viewer, 'viewer'], [owner, 'owner']]) {
    await setup.query('INSERT INTO users (id, role) VALUES ($1, $2)', [id, role]);
  }
  for (const file of ['1785683496295_add-permission-tables.sql', '1791849600000_add-collections.sql',
    '1791849600001_add-collections-permissions.sql', '1791849600002_add-collections-visibility-subheading.sql',
    '1792022400000_add-collections-featured.sql']) {
    const sql = await readFile(new URL(`../src/database/migrations/${file}`, import.meta.url), 'utf8');
    await setup.query(sql.split('-- Down Migration')[0].replaceAll('public.', `${schema}.`));
  }
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 6,
    options: `-c search_path=${schema}`, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  let failAfterOrder = false, failThumbnailUpdate = false, failCommitResponse = false, releases = 0;
  const queryWith = async (database, sql, params) => {
    const result = await database.query(sql.replaceAll('public.', `${schema}.`), params);
    if (failAfterOrder && /UPDATE public.collection_playlists AS item/.test(sql)) {
      failAfterOrder = false;
      throw new Error('Injected failure after changing playlist positions');
    }
    if (failThumbnailUpdate && /SET thumbnail_url = \$2/.test(sql)) {
      failThumbnailUpdate = false;
      throw new Error('Injected failure after thumbnail update');
    }
    if (failCommitResponse && sql === 'COMMIT') {
      failCommitResponse = false;
      throw new Error('Injected connection failure after commit');
    }
    return result;
  };
  const databaseMock = mock.module(new URL('../src/database/index.js', import.meta.url).href, { namedExports: {
    writePool: { query: (sql, params) => queryWith(pool, sql, params), async connect() {
      const client = await pool.connect();
      return { query: (sql, params) => queryWith(client, sql, params), release() { releases++; client.release(); } };
    } },
  } });
  const objects = new Map(), commands = [];
  let failPut = false, failDelete = false;
  const storageMock = mock.module(new URL('../src/modules/storage/r2.client.js', import.meta.url).href, { namedExports: {
    s3: { async send(command) {
      commands.push(command);
      const { Key, Body } = command.input;
      if (command.constructor.name === 'PutObjectCommand') {
        objects.set(Key, Body);
        if (failPut) throw new Error('Injected storage failure after upload');
      } else if (command.constructor.name === 'DeleteObjectCommand') {
        if (failDelete) throw new Error('Injected storage deletion failure');
        objects.delete(Key);
      } else throw new Error('Unexpected storage operation');
    } },
  } });
  const baseUrl = 'https://collections-r2.example.test';
  const previousStorage = { R2_PUBLIC_BASE_URL: process.env.R2_PUBLIC_BASE_URL, R2_BUCKET: process.env.R2_BUCKET };
  Object.assign(process.env, { R2_PUBLIC_BASE_URL: baseUrl, R2_BUCKET: 'collections-test' });
  const { default: router } = await import('../src/modules/collections/collections.routes.js');
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'collection-management-test-secret';
  const tokenFor = userId => jwt.sign({ sub: userId, authzVersion: 1 }, process.env.JWT_SECRET);
  const app = express();
  app.use(express.json()); app.use('/api/collections', router); app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await pool.end(); databaseMock.restore();
    storageMock.restore();
    for (const [key, value] of Object.entries(previousStorage)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  });
  async function request(method, path = '', body, userId = creator) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/collections${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...(userId ? { Authorization: `Bearer ${tokenFor(userId)}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, ...await response.json() };
  }
  const create = async (title = 'Collection', userId = creator) => {
    const response = await request('POST', '', { title, description: 'Original description' }, userId);
    assert.equal(response.status, 201); return response.collection;
  };
  const playlist = async (status = 'public', userId = other) => {
    const id = randomUUID();
    await setup.query('INSERT INTO playlists (id, created_by, status) VALUES ($1,$2,$3)', [id, userId, status]);
    return id;
  };
  const items = async id => (await setup.query('SELECT * FROM collection_playlists WHERE collection_id=$1 ORDER BY position,id', [id])).rows;
  const saved = async id => (await setup.query('SELECT * FROM collections WHERE id=$1', [id])).rows[0];
  async function thumbnail(id, buffer, { userId = creator, type = 'image/png', field = 'file' } = {}) {
    let body;
    if (buffer !== undefined) {
      body = new FormData();
      body.append(field, new Blob([buffer], { type }), 'thumbnail');
    }
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/collections/${id}/thumbnail`, {
      method: 'POST', headers: userId ? { Authorization: `Bearer ${tokenFor(userId)}` } : {}, body,
    });
    return { status: response.status, ...await response.json() };
  }
  const png = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#336699' } }).png().toBuffer();
  async function scenario(name, run) {
    await t.test(name, async t => {
      await setup.query('TRUNCATE collections, playlists, videos CASCADE');
      objects.clear(); commands.length = 0; failPut = false; failDelete = false;
      await run(t);
    });
  }

  await scenario('public listing supports creator/title filters, pagination, empty pages and stable sorting', async () => {
    const a = await create('Alpha'), b = await create('Beta'), c = await create('Beta', other);
    await create('100%_literal');
    await setup.query("UPDATE collections SET created_at='2026-01-01', updated_at='2026-01-01'");
    const all = await request('GET', '', undefined, null);
    assert.equal(all.status, 200); assert.equal(all.pagination.total, 4);
    assert.deepEqual(all.sorting, { sortBy: 'created_at', sortOrder: 'asc' });
    assert.deepEqual(all.collections.map(row => row.id), all.collections.map(row => row.id).sort());
    const page = await request('GET', `?userId=${creator}&sortBy=title&sortOrder=desc&page=2&limit=1`);
    assert.deepEqual(page.collections.map(row => row.id), [a.id]);
    assert.deepEqual(page.pagination, { page: 2, limit: 1, total: 3, totalPages: 3, hasNextPage: true, hasPreviousPage: true });
    assert.deepEqual(page.sorting, { sortBy: 'title', sortOrder: 'desc' });
    assert.deepEqual((await request('GET', `?userId=${other}`)).collections.map(row => row.id), [c.id]);
    assert.deepEqual((await request('GET', '?title=beta&sortBy=title')).collections.map(row => row.id), [b.id, c.id].sort());
    assert.equal((await request('GET', '?title=%25_')).pagination.total, 1);
    const beyond = await request('GET', '?page=100&limit=1');
    assert.deepEqual(beyond.collections, []); assert.equal(beyond.pagination.total, 4);
    assert.equal((await request('GET', `?userId=${randomUUID()}`)).pagination.totalPages, 0);
    for (const sortBy of ['created_at', 'updated_at', 'title']) for (const sortOrder of ['asc', 'desc']) {
      assert.equal((await request('GET', `?sortBy=${sortBy}&sortOrder=${sortOrder}`)).status, 200);
    }
    for (const query of ['page=0', 'limit=101', 'sortBy=invalid', 'sortOrder=DESC', 'userId=invalid', 'page=9007199254740991&limit=100']) {
      assert.equal((await request('GET', `?${query}`)).status, 400);
    }
  });

  await scenario('featured creation and updates require a separate permission and preserve ordinary edits', async () => {
    const normal = await create();
    assert.equal(normal.is_featured, false);
    assert.equal((await request('POST', '', { title: 'Not featured', is_featured: false })).status, 201);
    assert.equal((await request('POST', '', { title: 'Denied', is_featured: true })).status, 403);
    assert.equal((await setup.query("SELECT count(*)::int AS n FROM collections WHERE title='Denied'")).rows[0].n, 0);
    for (const is_featured of [true, false]) {
      const before = await saved(normal.id);
      assert.equal((await request('PATCH', `/${normal.id}`, { title: 'Must not change', is_featured })).status, 403);
      assert.deepEqual(await saved(normal.id), before);
    }
    for (const userId of [admin, owner]) {
      const featured = await request('POST', '', { title: 'Featured', is_featured: true }, userId);
      assert.equal(featured.status, 201); assert.equal(featured.collection.is_featured, true);
    }
    const featured = await request('PATCH', `/${normal.id}`, { is_featured: true }, admin);
    assert.equal(featured.status, 200); assert.equal(featured.collection.is_featured, true);
    assert.equal((await request('GET', `/${normal.id}`, undefined, null)).collection.is_featured, true);
    const edit = await request('PATCH', `/${normal.id}`, { title: 'Ordinary edit' });
    assert.equal(edit.status, 200); assert.equal(edit.collection.is_featured, true);
    const cleared = await request('PATCH', `/${normal.id}`, { is_featured: false }, admin);
    assert.equal(cleared.status, 200); assert.equal(cleared.collection.is_featured, false);
    for (const value of ['true', 'false', null, 1]) {
      assert.equal((await request('POST', '', { title: 'Invalid', is_featured: value }, admin)).status, 400);
      assert.equal((await request('PATCH', `/${normal.id}`, { is_featured: value }, admin)).status, 400);
    }
  });

  await scenario('featured permission respects active roles and denies, with the standard Owner bypass', async t => {
    const { rows: [role] } = await setup.query("INSERT INTO roles(name, position) VALUES ('Feature curator', 5) RETURNING id");
    t.after(() => setup.query('DELETE FROM roles WHERE id=$1', [role.id]));
    await setup.query(`INSERT INTO role_permissions(role_id, permission_id, effect)
      SELECT $1, id, 'allow' FROM permissions WHERE key='collections.feature'`, [role.id]);
    for (const userId of [creator, viewer]) {
      await setup.query('INSERT INTO user_roles(user_id, role_id) VALUES ($1, $2)', [userId, role.id]);
    }
    const mine = await request('POST', '', { title: 'Curated', is_featured: true });
    assert.equal(mine.status, 201);
    const otherCollection = await create('Other', other);
    assert.equal((await request('PATCH', `/${otherCollection.id}`, { is_featured: true })).status, 403);
    assert.equal((await request('POST', '', { title: 'Viewer', is_featured: true }, viewer)).status, 403);
    assert.equal((await request('PATCH', `/${mine.collection.id}`, { is_featured: false }, viewer)).status, 403);
    await setup.query("UPDATE user_roles SET expires_at=now()-interval '1 minute' WHERE user_id=$1 AND role_id=$2", [creator, role.id]);
    assert.equal((await request('PATCH', `/${mine.collection.id}`, { is_featured: false })).status, 403);
    await setup.query('UPDATE user_roles SET expires_at=NULL WHERE user_id=$1 AND role_id=$2', [creator, role.id]);
    assert.equal((await request('PATCH', `/${mine.collection.id}`, { is_featured: false })).status, 200);
    await setup.query(`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE is_owner)
      AND permission_id = (SELECT id FROM permissions WHERE key='collections.feature')`);
    t.after(() => setup.query(`INSERT INTO role_permissions(role_id, permission_id, effect)
      SELECT r.id, p.id, 'allow' FROM roles r CROSS JOIN permissions p
      WHERE r.is_owner AND p.key='collections.feature'`));
    assert.equal((await request('POST', '', { title: 'Owner without grant', is_featured: true }, owner)).status, 201);
    assert.equal((await request('PATCH', `/${mine.collection.id}`, { is_featured: true }, owner)).status, 200);
    await setup.query("UPDATE role_permissions SET effect='deny' WHERE role_id=$1", [role.id]);
    for (const userId of [admin, owner]) {
      await setup.query('INSERT INTO user_roles(user_id, role_id) VALUES ($1,$2)', [userId, role.id]);
      assert.equal((await request('POST', '', { title: 'Role deny', is_featured: true }, userId)).status, userId === owner ? 201 : 403);
      const updated = await request('PATCH', `/${mine.collection.id}`, { is_featured: false }, userId);
      assert.equal(updated.status, userId === owner ? 200 : 403);
      if (userId === owner) assert.equal(updated.collection.is_featured, false);
    }
  });

  await scenario('featured filters combine with visibility, creator, title, pagination and sorting', async () => {
    const a = await request('POST', '', { title: 'Featured Alpha', is_featured: true }, admin);
    const b = await request('POST', '', { title: 'Featured Beta', is_featured: true }, admin);
    const privateFeatured = await request('POST', '', { title: 'Featured Private', is_featured: true, visibility: 'private' }, admin);
    const normal = await create('Normal');
    const guest = await request('GET', '?is_featured=true&sortBy=title&sortOrder=desc&limit=1', undefined, null);
    assert.equal(guest.status, 200); assert.deepEqual(guest.collections.map(row => row.id), [b.collection.id]);
    assert.equal(guest.collections[0].is_featured, true);
    assert.deepEqual(guest.pagination, { page: 1, limit: 1, total: 2, totalPages: 2, hasNextPage: true, hasPreviousPage: false });
    assert.deepEqual((await request('GET', '?is_featured=true&sortBy=title&sortOrder=desc&limit=1&page=2', undefined, null)).collections.map(row => row.id), [a.collection.id]);
    const beyond = await request('GET', '?is_featured=true&page=99&limit=1', undefined, null);
    assert.equal(beyond.pagination.total, 2); assert.deepEqual(beyond.collections, []);
    assert.deepEqual((await request('GET', '?is_featured=false', undefined, null)).collections.map(row => row.id), [normal.id]);
    assert.equal((await request('GET', '', undefined, null)).pagination.total, 3);
    assert.equal((await request('GET', '?is_featured=true', undefined, admin)).pagination.total, 3);
    assert.deepEqual((await request('GET', `?is_featured=true&userId=${admin}&title=Alpha`, undefined, null)).collections.map(row => row.id), [a.collection.id]);
    assert.equal((await request('GET', `?is_featured=true&userId=${admin}&visibility=private`, undefined, null)).pagination.total, 0);
    assert.deepEqual((await request('GET', `?is_featured=true&userId=${admin}&visibility=private`, undefined, admin)).collections.map(row => row.id), [privateFeatured.collection.id]);
    assert.equal((await request('GET', `/${privateFeatured.collection.id}`, undefined, null)).status, 404);
    for (const value of ['', '1', '0', 'TRUE', 'null', 'true&is_featured=false']) {
      assert.equal((await request('GET', `?is_featured=${value}`, undefined, null)).status, 400);
    }
  });

  await scenario('collection detail returns all metadata and ordered playlist cards with independent visibility checks', async () => {
    const collection = (await request('POST', '', {
      title: 'Details', subheading: 'Subtitle', description: 'Description', visibility: 'public',
    })).collection;
    const publicId = await playlist(), ownPrivateId = await playlist('private', creator), laterPrivateId = await playlist();
    const path = `/${collection.id}`;
    await request('POST', path + '/playlists', { playlist_ids: [publicId, ownPrivateId, laterPrivateId] });
    await request('PATCH', path + '/playlists/reorder', { playlist_ids: [ownPrivateId, laterPrivateId, publicId] });
    await setup.query("UPDATE playlists SET status='private' WHERE id=$1", [laterPrivateId]);
    await setup.query("UPDATE playlists SET title='Public playlist', thumbnail_url='https://cdn.example.test/custom.webp', view_count=42 WHERE id=$1", [publicId]);
    const guest = await request('GET', path, undefined, null);
    assert.equal(guest.status, 200); assert.equal(guest.success, true);
    assert.deepEqual(Object.keys(guest.collection).sort(), Object.keys(collection).sort());
    for (const field of ['id', 'title', 'subheading', 'description', 'visibility', 'thumbnail_url', 'created_by']) {
      assert.deepEqual(guest.collection[field], collection[field]);
    }
    assert.ok(Number.isFinite(Date.parse(guest.collection.created_at)));
    assert.ok(Number.isFinite(Date.parse(guest.collection.updated_at)));
    assert.deepEqual(guest.playlists, [{ id: publicId, title: 'Public playlist', status: 'public',
      thumbnail_url: 'https://cdn.example.test/custom.webp', view_count: 42, video_count: 0,
      created_at: guest.playlists[0].created_at, position: 2, media_expires_at: null }]);
    const mine = await request('GET', path);
    assert.deepEqual(mine.playlists.map(card => card.id), [ownPrivateId, publicId]);
    assert.deepEqual(mine.playlists.map(card => card.position), [0, 2]);
    const theirs = await request('GET', path, undefined, other);
    assert.deepEqual(theirs.playlists.map(card => card.id), [laterPrivateId, publicId]);
    assert.deepEqual((await request('GET', path, undefined, admin)).playlists.map(card => card.id), [publicId]);
    assert.deepEqual((await request('GET', `${path}?userId=${creator}`, undefined, null)).playlists.map(card => card.id), [publicId]);
    await setup.query('UPDATE collection_playlists SET position=0 WHERE collection_id=$1', [collection.id]);
    assert.deepEqual((await request('GET', path)).playlists.map(card => card.id), [ownPrivateId, publicId].sort());
  });

  await scenario('collection detail hides private collections, handles missing IDs and returns an empty playlist array', async () => {
    const collection = (await request('POST', '', { title: 'Private detail', visibility: 'private' })).collection;
    const path = `/${collection.id}`;
    for (const userId of [null, other, viewer, admin, owner]) {
      assert.deepEqual(await request('GET', path, undefined, userId), {
        status: 404, success: false, message: 'Collection not found',
      });
    }
    const mine = await request('GET', path);
    assert.equal(mine.status, 200); assert.equal(mine.collection.visibility, 'private');
    assert.deepEqual(mine.playlists, []);
    assert.equal((await request('GET', `/${randomUUID()}`, undefined, null)).status, 404);
    assert.equal((await request('GET', '/invalid', undefined, null)).status, 400);
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/collections${path}`, {
      headers: { Authorization: `Bearer ${tokenFor(creator)}` },
    });
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    await response.json();
    await request('PATCH', path, { visibility: 'public' });
    assert.equal((await request('GET', path, undefined, null)).status, 200);
    await request('PATCH', path, { visibility: 'private' });
    assert.equal((await request('GET', path, undefined, null)).status, 404);
    await request('DELETE', path);
    assert.equal((await request('GET', path)).status, 404);
  });

  await scenario('playlist cards reuse video counts and first accessible video thumbnails, reflecting reorder and removal', async () => {
    const collection = await create(), p = await playlist();
    const path = `/${collection.id}`;
    await request('POST', path + '/playlists', { playlist_ids: [p] });
    const publicVideo = randomUUID(), privateVideo = randomUUID(), futureVideo = randomUUID(), unreadyVideo = randomUUID();
    for (const [id, visibility, muxStatus, publishedAt, position, thumbnail] of [
      [futureVideo, 'public', 'ready', '2999-01-01', 0, 'https://cdn.example.test/future.webp'],
      [unreadyVideo, 'public', 'preparing', '2000-01-01', 1, 'https://cdn.example.test/unready.webp'],
      [privateVideo, 'private', 'ready', '2000-01-01', 2, 'https://cdn.example.test/private.webp'],
      [publicVideo, 'public', 'ready', '2000-01-01', 3, null],
    ]) {
      await setup.query(`INSERT INTO videos (id, uploaded_by, visibility, mux_status, published_at, thumbnail_url,
        mux_playback_id, playback_policy, mux_thumbnail_time, duration_seconds)
        VALUES ($1,$2,$3,$4,$5,$6,'collection-playback','public',12,120)`,
      [id, creator, visibility, muxStatus, publishedAt, thumbnail]);
      await setup.query('INSERT INTO playlist_items (playlist_id,video_id,position) VALUES ($1,$2,$3)', [p, id, position]);
    }
    const guest = await request('GET', path, undefined, null);
    assert.equal(guest.status, 200); assert.equal(guest.playlists[0].video_count, 1);
    const url = new URL(guest.playlists[0].thumbnail_url);
    assert.equal(url.hostname, 'image.mux.com'); assert.equal(url.pathname, '/collection-playback/thumbnail.webp');
    assert.equal(url.searchParams.get('time'), '12');
    assert.equal(guest.playlists[0].media_expires_at, null);
    // The existing media helper allows video owners to see their own scheduled/private artwork.
    assert.equal((await request('GET', path)).playlists[0].thumbnail_url, 'https://cdn.example.test/future.webp');
    await setup.query('UPDATE playlist_items SET position=-1 WHERE video_id=$1', [privateVideo]);
    assert.equal((await request('GET', path)).playlists[0].thumbnail_url, 'https://cdn.example.test/private.webp');
    await setup.query('DELETE FROM videos WHERE id=$1', [publicVideo]);
    const empty = await request('GET', path, undefined, null);
    assert.equal(empty.playlists[0].thumbnail_url, null); assert.equal(empty.playlists[0].video_count, 0);
    await request('DELETE', `${path}/playlists/${p}`);
    assert.deepEqual((await request('GET', path)).playlists, []);
  });

  await scenario('PATCH preserves omitted fields and DELETE cascades only memberships', async () => {
    const collection = await create(), p = await playlist();
    await setup.query("UPDATE collections SET updated_at='2000-01-01' WHERE id=$1", [collection.id]);
    const patched = await request('PATCH', `/${collection.id}`, { title: ' Renamed ' });
    assert.equal(patched.status, 200); assert.equal(patched.collection.title, 'Renamed');
    assert.equal(patched.collection.description, collection.description);
    assert.ok(new Date(patched.collection.updated_at).getFullYear() > 2000);
    assert.equal((await request('PATCH', `/${collection.id}`, { description: null })).collection.description, null);
    for (const body of [{}, { created_by: other }, { title: ' ' }, { playlist_ids: [] }]) {
      assert.equal((await request('PATCH', `/${collection.id}`, body)).status, 400);
    }
    assert.equal((await request('POST', `/${collection.id}/playlists`, { playlist_ids: [p] })).status, 201);
    assert.deepEqual(await request('DELETE', `/${collection.id}`), { status: 200, success: true, deleted: true });
    assert.deepEqual(await items(collection.id), []);
    assert.equal((await setup.query('SELECT id FROM playlists WHERE id=$1', [p])).rowCount, 1);
    assert.equal((await request('DELETE', `/${collection.id}`)).status, 404);
  });

  await scenario('creation and PATCH persist visibility and nullable subheading with backward-compatible defaults', async () => {
    const minimal = await create();
    assert.equal(minimal.visibility, 'public'); assert.equal(minimal.subheading, null);
    const created = await request('POST', '', { title: 'Private', subheading: ' Subtitle ', visibility: 'private' });
    assert.equal(created.status, 201); assert.equal(created.collection.visibility, 'private');
    assert.equal(created.collection.subheading, 'Subtitle');
    const id = created.collection.id;
    const titleOnly = await request('PATCH', `/${id}`, { title: 'Renamed' });
    assert.equal(titleOnly.collection.visibility, 'private'); assert.equal(titleOnly.collection.subheading, 'Subtitle');
    const patched = await request('PATCH', `/${id}`, { visibility: 'public', subheading: null });
    assert.equal(patched.status, 200); assert.equal(patched.collection.subheading, null);
    assert.equal(patched.collection.visibility, 'public');
    assert.equal((await saved(id)).visibility, 'public');
    const before = await saved(id);
    for (const invalid of [{ visibility: 'unlisted' }, { visibility: null }, { subheading: 1 }, { subheading: 'x'.repeat(256) }]) {
      assert.equal((await request('POST', '', { title: 'Invalid', ...invalid })).status, 400);
      assert.equal((await request('PATCH', `/${id}`, invalid)).status, 400);
    }
    assert.deepEqual(await saved(id), before);
  });

  await scenario('private collections appear only to their authenticated creator and never inflate public pagination totals', async () => {
    const publicOwn = await create('Public own'), publicOther = await create('Public other', other);
    const privateOwn = (await request('POST', '', { title: 'Secret own', visibility: 'private', subheading: 'Hidden subtitle' })).collection;
    const privateOther = (await request('POST', '', { title: 'Secret other', visibility: 'private' }, other)).collection;
    const ids = response => response.collections.map(collection => collection.id).sort();
    const guest = await request('GET', '', undefined, null);
    assert.deepEqual(ids(guest), [publicOwn.id, publicOther.id].sort());
    assert.equal(guest.pagination.total, 2);
    const mine = await request('GET', `?userId=${creator}`);
    assert.deepEqual(ids(mine), [publicOwn.id, privateOwn.id].sort());
    assert.equal(mine.collections.find(collection => collection.id === privateOwn.id).subheading, 'Hidden subtitle');
    assert.deepEqual(ids(await request('GET')), [publicOwn.id, publicOther.id, privateOwn.id].sort());
    assert.deepEqual(ids(await request('GET', `?userId=${other}`)), [publicOther.id]);
    assert.deepEqual(ids(await request('GET', `?userId=${creator}`, undefined, null)), [publicOwn.id]);
    assert.deepEqual(ids(await request('GET', `?userId=${other}`, undefined, other)), [publicOther.id, privateOther.id].sort());
    for (const userId of [null, viewer, admin, owner]) {
      const response = await request('GET', `?userId=${creator}&visibility=private&limit=1`, undefined, userId);
      assert.deepEqual(response.collections, []);
      assert.deepEqual(response.pagination, { page: 1, limit: 1, total: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false });
    }
    const filtered = await request('GET', '?visibility=private&title=Secret&limit=1');
    assert.deepEqual(ids(filtered), [privateOwn.id]); assert.equal(filtered.pagination.total, 1);
    assert.equal((await request('GET', '?visibility=public')).pagination.total, 2);
    const page = await request('GET', '?sortBy=title&limit=1&page=2', undefined, null);
    assert.equal(page.pagination.totalPages, 2); assert.equal(page.pagination.hasNextPage, false);
    assert.equal((await request('GET', '?title=Secret', undefined, null)).pagination.total, 0);
    assert.equal((await request('GET', '?visibility=unlisted')).status, 400);
    assert.equal((await request('GET', `?viewerId=${other}`)).status, 400);
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/collections?userId=${creator}`, {
      headers: { Authorization: `Bearer ${tokenFor(creator)}` },
    });
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    await response.json();
    assert.equal((await request('PATCH', `/${publicOwn.id}`, { visibility: 'private' })).status, 200);
    assert.equal((await request('GET', `?userId=${creator}`, undefined, null)).pagination.total, 0);
    await request('PATCH', `/${privateOwn.id}`, { visibility: 'public' });
    assert.deepEqual(ids(await request('GET', `?userId=${creator}`, undefined, null)), [privateOwn.id]);
  });

  await scenario('visibility never grants write access, while owners can manage their private collection and moderators retain any permissions', async () => {
    const collection = (await request('POST', '', { title: 'Secret', visibility: 'private', subheading: 'Subtitle' })).collection;
    const p = await playlist();
    const path = `/${collection.id}`;
    for (const [method, suffix, body] of [
      ['PATCH', '', { visibility: 'public' }], ['DELETE', ''],
      ['POST', '/playlists', { playlist_ids: [p] }], ['DELETE', `/playlists/${p}`],
      ['PATCH', '/playlists/reorder', { playlist_ids: [] }],
    ]) assert.equal((await request(method, path + suffix, body, other)).status, 403);
    assert.equal((await thumbnail(collection.id, png, { userId: other })).status, 403);
    for (const response of [
      await request('POST', path + '/playlists', { playlist_ids: [p] }),
      await request('PATCH', path + '/playlists/reorder', { playlist_ids: [p] }),
      await thumbnail(collection.id, png),
      await request('DELETE', path + `/playlists/${p}`),
    ]) {
      assert.ok([200, 201].includes(response.status));
      assert.equal(response.collection.visibility, 'private'); assert.equal(response.collection.subheading, 'Subtitle');
    }
    assert.equal((await request('PATCH', path, { subheading: 'Admin edited' }, admin)).status, 200);
    assert.equal((await request('DELETE', path, undefined, owner)).status, 200);
    assert.equal((await request('DELETE', path)).status, 404);
  });

  await scenario('all write routes require ownership permissions; any permissions and Owner can manage foreign collections', async () => {
    const collection = await create(), p = await playlist();
    const operations = [
      ['PATCH', `/${collection.id}`, { title: 'Blocked' }], ['DELETE', `/${collection.id}`],
      ['POST', `/${collection.id}/playlists`, { playlist_ids: [p] }],
      ['DELETE', `/${collection.id}/playlists/${p}`], ['PATCH', `/${collection.id}/playlists/reorder`, { playlist_ids: [] }],
    ];
    for (const [method, path, body] of operations) {
      assert.equal((await request(method, path, body, null)).status, 401);
      assert.equal((await request(method, path, body, viewer)).status, 403);
      assert.equal((await request(method, path, body, other)).status, 403);
      assert.equal((await request(method, path.replace(collection.id, randomUUID()), body)).status, 404);
      assert.equal((await request(method, path.replace(collection.id, 'invalid'), body)).status, 400);
    }
    assert.equal((await saved(collection.id)).title, 'Collection'); assert.deepEqual(await items(collection.id), []);
    assert.equal((await request('PATCH', `/${collection.id}`, { title: 'Admin' }, admin)).status, 200);
    assert.equal((await request('POST', `/${collection.id}/playlists`, { playlist_ids: [p] }, admin)).status, 201);
    assert.equal((await request('PATCH', `/${collection.id}/playlists/reorder`, { playlist_ids: [p] }, owner)).status, 200);
    assert.equal((await request('DELETE', `/${collection.id}/playlists/${p}`, undefined, admin)).status, 200);
    assert.equal((await request('DELETE', `/${collection.id}`, undefined, owner)).status, 200);
  });

  await scenario('bulk add, reorder and remove preserve membership IDs, playlist records and contiguous positions', async () => {
    const collection = await create(), unrelated = await create('Unrelated');
    const ids = [await playlist(), await playlist('private', creator), await playlist()];
    const added = await request('POST', `/${collection.id}/playlists`, { playlist_ids: ids.slice(0, 2) });
    assert.equal(added.status, 201);
    assert.deepEqual(added.playlists.map(item => [item.playlist_id, item.position]), [[ids[0], 0], [ids[1], 1]]);
    assert.equal((await request('POST', `/${collection.id}/playlists`, { playlist_ids: [ids[2]] })).status, 201);
    const original = await items(collection.id);
    await request('POST', `/${unrelated.id}/playlists`, { playlist_ids: [ids[0]] });
    const reordered = await request('PATCH', `/${collection.id}/playlists/reorder`, { playlist_ids: [ids[2], ids[0], ids[1]] });
    assert.equal(reordered.status, 200);
    assert.deepEqual(reordered.playlists.map(item => [item.playlist_id, item.position]), [[ids[2], 0], [ids[0], 1], [ids[1], 2]]);
    for (const item of reordered.playlists) assert.equal(item.id, original.find(old => old.playlist_id === item.playlist_id).id);
    const removed = await request('DELETE', `/${collection.id}/playlists/${ids[0]}`);
    assert.equal(removed.status, 200); assert.equal(removed.removed, true);
    assert.deepEqual(removed.playlists.map(item => [item.playlist_id, item.position]), [[ids[2], 0], [ids[1], 1]]);
    assert.equal((await items(unrelated.id)).length, 1);
    assert.equal((await setup.query('SELECT count(*)::int AS n FROM playlists')).rows[0].n, 3);
  });

  await scenario('invalid or stale membership requests are atomic and return clear errors', async () => {
    const collection = await create(), first = await playlist(), second = await playlist(), hidden = await playlist('private', other);
    const path = `/${collection.id}/playlists`;
    await request('POST', path, { playlist_ids: [first] });
    const before = await items(collection.id), beforeCollection = await saved(collection.id);
    for (const ids of [[second, randomUUID()], [second, hidden]]) assert.equal((await request('POST', path, { playlist_ids: ids })).status, 404);
    assert.equal((await request('POST', path, { playlist_ids: [second, first] })).status, 409);
    assert.equal((await request('POST', path, { playlist_ids: [second, second.toUpperCase()] })).status, 400);
    for (const ids of [[], [second], [first, second]]) assert.equal((await request('PATCH', `${path}/reorder`, { playlist_ids: ids })).status, 409);
    assert.equal((await request('PATCH', `${path}/reorder`, { playlist_ids: [first, first] })).status, 400);
    assert.equal((await request('DELETE', `${path}/${second}`)).status, 404);
    assert.equal((await request('DELETE', `${path}/invalid`)).status, 400);
    assert.deepEqual(await items(collection.id), before);
    assert.deepEqual(await saved(collection.id), beforeCollection);
    await request('DELETE', `${path}/${first}`);
    assert.equal((await request('PATCH', `${path}/reorder`, { playlist_ids: [] })).status, 200);
  });

  await scenario('failures after writes roll back additions, removals, order and timestamps and release clients', async t => {
    t.mock.method(console, 'error', () => {});
    const collection = await create(), ids = [await playlist(), await playlist(), await playlist()];
    const path = `/${collection.id}/playlists`;
    await request('POST', path, { playlist_ids: ids.slice(0, 2) });
    const before = await items(collection.id), beforeCollection = await saved(collection.id);
    for (const [method, suffix, body] of [
      ['POST', '', { playlist_ids: [ids[2]] }], ['DELETE', `/${ids[0]}`],
      ['PATCH', '/reorder', { playlist_ids: [ids[1], ids[0]] }],
    ]) {
      const releasedBefore = releases; failAfterOrder = true;
      const response = await request(method, path + suffix, body);
      assert.equal(response.status, 500); assert.equal(response.message, 'Unable to process the collection request');
      assert.equal(releases, releasedBefore + 1);
      assert.deepEqual(await items(collection.id), before);
      assert.deepEqual(await saved(collection.id), beforeCollection);
    }
  });

  await scenario('concurrent additions and reorders serialize without duplicate positions or lost memberships', async () => {
    const collection = await create(), ids = [await playlist(), await playlist(), await playlist()];
    const path = `/${collection.id}/playlists`;
    const added = await Promise.all(ids.map(id => request('POST', path, { playlist_ids: [id] })));
    assert.deepEqual(added.map(result => result.status), [201, 201, 201]);
    assert.deepEqual((await items(collection.id)).map(item => item.position), [0, 1, 2]);
    const reordered = await Promise.all([ids, ids.slice().reverse()].map(order => request('PATCH', `${path}/reorder`, { playlist_ids: order })));
    assert.deepEqual(reordered.map(result => result.status), [200, 200]);
    const final = await items(collection.id);
    assert.deepEqual(final.map(item => item.position), [0, 1, 2]);
    assert.deepEqual(final.map(item => item.playlist_id).sort(), ids.slice().sort());
    const newId = await playlist();
    const duplicate = await Promise.all([1, 2].map(() => request('POST', path, { playlist_ids: [newId] })));
    assert.deepEqual(duplicate.map(result => result.status).sort(), [201, 409]);
    assert.deepEqual((await items(collection.id)).map(item => item.position), [0, 1, 2, 3]);
  });

  await scenario('thumbnail accepts JPEG, PNG and WebP, normalizes the image and replaces or removes the old object', async () => {
    const collection = await create();
    await setup.query("UPDATE collections SET updated_at='2000-01-01' WHERE id=$1", [collection.id]);
    let previousKey;
    for (const format of ['png', 'jpeg', 'webp']) {
      const input = await sharp(png).toFormat(format).toBuffer();
      const response = await thumbnail(collection.id, input, { type: `image/${format}` });
      assert.equal(response.status, 200); assert.equal(response.success, true);
      assert.equal(response.collection.id, collection.id);
      assert.equal(response.collection.title, collection.title);
      assert.ok(new Date(response.collection.updated_at).getFullYear() > 2000);
      const key = response.collection.thumbnail_url.slice(baseUrl.length + 1);
      assert.ok(key.startsWith(`collection-thumbnails/${collection.id}/`));
      const metadata = await sharp(objects.get(key)).metadata();
      assert.equal(metadata.width, 1280); assert.equal(metadata.height, 720); assert.equal(metadata.format, 'webp');
      const put = commands.find(command => command.input.Key === key);
      assert.equal(put.input.ContentType, 'image/webp');
      assert.equal(put.input.CacheControl, 'public, max-age=31536000, immutable');
      assert.equal((await saved(collection.id)).thumbnail_url, response.collection.thumbnail_url);
      if (previousKey) assert.equal(objects.has(previousKey), false);
      assert.equal(objects.size, 1); previousKey = key;
    }
    const removed = await thumbnail(collection.id);
    assert.equal(removed.status, 200); assert.equal(removed.collection.thumbnail_url, null);
    assert.equal((await saved(collection.id)).thumbnail_url, null); assert.equal(objects.size, 0);
    assert.equal((await thumbnail(collection.id)).status, 200);
  });

  await scenario('thumbnail writes require authentication and own/any update permission before processing uploads', async () => {
    const collection = await create();
    for (const userId of [null, viewer, other]) {
      assert.equal((await thumbnail(collection.id, png, { userId })).status, userId === null ? 401 : 403);
      assert.equal((await thumbnail(collection.id, undefined, { userId })).status, userId === null ? 401 : 403);
    }
    assert.equal((await thumbnail('invalid', png)).status, 400);
    assert.equal((await thumbnail(randomUUID(), png)).status, 404);
    assert.equal(commands.length, 0);
    assert.equal((await thumbnail(collection.id, png, { userId: admin })).status, 200);
    assert.equal((await thumbnail(collection.id, undefined, { userId: owner })).status, 200);
  });

  await scenario('malformed, oversized and unsupported thumbnail uploads preserve the existing thumbnail', async () => {
    const collection = await create();
    await thumbnail(collection.id, png);
    const before = await saved(collection.id), oldObjects = new Map(objects), countBefore = commands.length;
    for (const [buffer, options] of [
      [png, { type: 'image/gif' }], [Buffer.from('not an image'), {}], [Buffer.alloc(0), {}],
      [Buffer.alloc(5 * 1024 * 1024 + 1), {}], [png, { field: 'wrong_field' }],
      [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'), {}],
    ]) assert.equal((await thumbnail(collection.id, buffer, options)).status, 400);
    assert.deepEqual(await saved(collection.id), before); assert.deepEqual(objects, oldObjects);
    assert.equal(commands.length, countBefore);
  });

  await scenario('thumbnail storage and database failures preserve the old URL and clean up the new upload', async t => {
    t.mock.method(console, 'error', () => {});
    const collection = await create();
    await thumbnail(collection.id, png);
    const before = await saved(collection.id), oldObjects = new Map(objects);
    for (const failure of ['storage', 'database', 'removal']) {
      failPut = failure === 'storage'; failThumbnailUpdate = failure !== 'storage';
      const releasedBefore = releases;
      const response = await thumbnail(collection.id, failure === 'removal' ? undefined : png);
      assert.equal(response.status, 500);
      assert.equal(response.message, 'Unable to process the collection request');
      assert.equal(releases, releasedBefore + 1);
      assert.deepEqual(await saved(collection.id), before); assert.deepEqual(objects, oldObjects);
    }
    failPut = false;
  });

  await scenario('thumbnail cleanup only deletes objects belonging to the collection and tolerates cleanup failures', async t => {
    const collection = await create();
    for (const url of [
      `${baseUrl}/playlist-thumbnails/${collection.id}/old.webp`,
      `${baseUrl}/collection-thumbnails/${randomUUID()}/old.webp`,
      `${baseUrl}.evil.test/collection-thumbnails/${collection.id}/old.webp`,
    ]) {
      await setup.query('UPDATE collections SET thumbnail_url=$2 WHERE id=$1', [collection.id, url]);
      assert.equal((await thumbnail(collection.id)).status, 200);
    }
    assert.equal(commands.length, 0);
    await thumbnail(collection.id, png);
    const before = await saved(collection.id);
    t.mock.method(console, 'warn', () => {});
    failDelete = true;
    const replaced = await thumbnail(collection.id, png);
    assert.equal(replaced.status, 200);
    assert.notEqual(replaced.collection.thumbnail_url, before.thumbnail_url);
    assert.equal((await saved(collection.id)).thumbnail_url, replaced.collection.thumbnail_url);
  });

  await scenario('concurrent thumbnail replacements keep the final referenced object and remove superseded uploads', async () => {
    const collection = await create();
    const responses = await Promise.all([1, 2, 3].map(() => thumbnail(collection.id, png)));
    assert.deepEqual(responses.map(response => response.status), [200, 200, 200]);
    const final = await saved(collection.id);
    assert.equal(objects.size, 1);
    assert.ok(objects.has(final.thumbnail_url.slice(baseUrl.length + 1)));
  });

  await scenario('a lost commit response retains the possibly committed thumbnail instead of deleting it', async t => {
    t.mock.method(console, 'error', () => {});
    const collection = await create();
    await thumbnail(collection.id, png);
    const before = await saved(collection.id);
    failCommitResponse = true;
    assert.equal((await thumbnail(collection.id, png)).status, 500);
    const after = await saved(collection.id);
    assert.notEqual(after.thumbnail_url, before.thumbnail_url);
    assert.ok(objects.has(after.thumbnail_url.slice(baseUrl.length + 1)));
    assert.ok(objects.has(before.thumbnail_url.slice(baseUrl.length + 1)));
  });
});
