import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { mock, test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { Permissions } from '../src/modules/authorization/permission.constants.js';
import { errorHandler } from '../src/middleware/error-handler.js';

async function migration(file) {
  const sql = await readFile(new URL(`../src/database/migrations/${file}`, import.meta.url), 'utf8');
  return sql.replaceAll('public.', 'pg_temp.').split('-- Down Migration');
}

test('collection schema, permissions and rollback against session-local PostgreSQL tables', {
  skip: !process.env.TEST_DATABASE_URL,
}, async t => {
  const client = new pg.Client({
    connectionString: process.env.TEST_DATABASE_URL,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  });
  await client.connect();
  t.after(() => client.end());
  await client.query(`
    CREATE TEMP TABLE users (id uuid PRIMARY KEY, role text);
    CREATE TEMP TABLE playlists (id uuid PRIMARY KEY);
    SET search_path TO pg_temp;
  `);
  const [basePermissions] = await migration('1785683496295_add-permission-tables.sql');
  const [schemaUp, schemaDown] = await migration('1791849600000_add-collections.sql');
  const [fieldsUp, fieldsDown] = await migration('1791849600002_add-collections-visibility-subheading.sql');
  const [permissionsUp, permissionsDown] = await migration('1791849600001_add-collections-permissions.sql');
  await client.query(basePermissions);
  await client.query(schemaUp);
  const userId = randomUUID(), playlistId = randomUUID();
  await client.query('INSERT INTO users (id) VALUES ($1)', [userId]);
  await client.query('INSERT INTO playlists (id) VALUES ($1)', [playlistId]);
  const create = async () => (await client.query(
    'INSERT INTO collections (title, created_by) VALUES ($1, $2) RETURNING *', ['Collection', userId],
  )).rows[0];
  const link = async collectionId => (await client.query(
    'INSERT INTO collection_playlists (collection_id, playlist_id) VALUES ($1, $2) RETURNING *',
    [collectionId, playlistId],
  )).rows[0];
  const count = async table => (await client.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;

  await t.test('defaults, nullable fields, required fields and foreign keys', async () => {
    const collection = await create();
    assert.ok(collection.id);
    assert.equal(collection.description, null);
    assert.equal(collection.thumbnail_url, null);
    assert.ok(collection.created_at instanceof Date);
    assert.ok(collection.updated_at instanceof Date);
    const membership = await link(collection.id);
    assert.ok(membership.id);
    assert.equal(membership.position, 0);
    assert.ok(membership.created_at instanceof Date);
    await assert.rejects(client.query('INSERT INTO collections (created_by) VALUES ($1)', [userId]), { code: '23502' });
    await assert.rejects(client.query("INSERT INTO collections (title) VALUES ('Missing creator')"), { code: '23502' });
    await assert.rejects(client.query('INSERT INTO collections (title, created_by) VALUES ($1, $2)', ['x'.repeat(256), userId]), { code: '22001' });
    await assert.rejects(client.query('INSERT INTO collections (title, created_by) VALUES ($1, $2)', ['Missing user', randomUUID()]), { code: '23503' });
    await assert.rejects(link(randomUUID()), { code: '23503' });
    await assert.rejects(client.query('INSERT INTO collection_playlists (collection_id, playlist_id) VALUES ($1, $2)', [collection.id, randomUUID()]), { code: '23503' });
    await assert.rejects(client.query('UPDATE collection_playlists SET position = NULL'), { code: '23502' });
    await assert.rejects(link(collection.id), { code: '23505' });
    // The specification does not cascade deletion of the collection creator.
    await assert.rejects(client.query('DELETE FROM users WHERE id = $1', [userId]), { code: '23503' });
  });

  await t.test('many-to-many memberships and both deletion cascades preserve the other entity', async () => {
    const second = await create();
    await link(second.id);
    assert.equal(await count('collection_playlists'), 2);
    await client.query('DELETE FROM collections WHERE id = $1', [second.id]);
    assert.equal(await count('collection_playlists'), 1);
    assert.equal(await count('playlists'), 1);
    await client.query('DELETE FROM playlists WHERE id = $1', [playlistId]);
    assert.equal(await count('collection_playlists'), 0);
    assert.equal(await count('collections'), 1);
  });

  await t.test('visibility migration preserves existing records, enforces constraints and supports rollback', async () => {
    const before = (await client.query('SELECT * FROM collections')).rows[0];
    await client.query(fieldsUp);
    const after = (await client.query('SELECT * FROM collections')).rows[0];
    assert.deepEqual(after, { ...before, visibility: 'public', subheading: null });
    await assert.rejects(client.query("UPDATE collections SET visibility = 'unlisted'"), { code: '23514' });
    await assert.rejects(client.query('UPDATE collections SET visibility = NULL'), { code: '23502' });
    await assert.rejects(client.query('UPDATE collections SET subheading = $1', ['x'.repeat(256)]), { code: '22001' });
    await client.query("UPDATE collections SET visibility = 'private', subheading = 'Subtitle'");
    await client.query(fieldsDown);
    assert.deepEqual((await client.query('SELECT * FROM collections')).rows[0], before);
    await client.query(fieldsUp);
  });

  await t.test('permission seed matches constants and grants only the intended roles', async () => {
    await client.query(permissionsUp);
    const keys = Object.entries(Permissions).filter(([name]) => name.startsWith('COLLECTIONS_')).map(([, key]) => key).sort();
    assert.equal(keys.length, 5);
    const seeded = (await client.query("SELECT key FROM permissions WHERE resource_type = 'collection' ORDER BY key")).rows.map(row => row.key);
    assert.deepEqual(seeded, keys);
    const grants = (await client.query(`
      SELECT r.name, array_agg(p.key ORDER BY p.key) AS keys
      FROM roles r JOIN role_permissions rp ON rp.role_id = r.id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE p.resource_type = 'collection' AND rp.effect = 'allow'
      GROUP BY r.name ORDER BY r.name
    `)).rows;
    assert.deepEqual(grants, [
      { name: 'Administrator', keys },
      { name: 'Uploader', keys: ['collections.create', 'collections.delete_own', 'collections.update_own'] },
    ]);
    await client.query(`UPDATE role_permissions SET effect = 'deny'
      WHERE role_id = (SELECT id FROM roles WHERE name = 'Uploader')
      AND permission_id = (SELECT id FROM permissions WHERE key = 'collections.create')`);
    await client.query(permissionsUp);
    const { rows } = await client.query(`SELECT effect FROM role_permissions
      WHERE role_id = (SELECT id FROM roles WHERE name = 'Uploader')
      AND permission_id = (SELECT id FROM permissions WHERE key = 'collections.create')`);
    assert.equal(rows[0].effect, 'deny');
  });

  await t.test('rollback removes only collection schema and permissions and supports reapplying', async () => {
    const before = await count('permissions');
    await client.query(permissionsDown);
    assert.equal(await count('permissions'), before - 5);
    await client.query(schemaDown);
    const { rows } = await client.query("SELECT to_regclass('pg_temp.collections') AS collections, to_regclass('pg_temp.collection_playlists') AS links");
    assert.deepEqual(rows[0], { collections: null, links: null });
    assert.equal(await count('users'), 1);
    await client.query(schemaUp);
    await client.query(fieldsUp);
    await client.query(permissionsUp);
    assert.equal(await count('permissions'), before);
    assert.equal(await count('collections'), 0);
  });

  await t.test('POST /api/collections enforces authentication, permissions and the creation contract', async t => {
    const errorLog = t.mock.method(console, 'error', () => {});
    let failInsert = false;
    const databaseMock = mock.module(new URL('../src/database/index.js', import.meta.url).href, {
      namedExports: { writePool: { query(sql, params) {
        if (failInsert && /INSERT INTO public.collections/.test(sql)) throw new Error('Private database failure');
        return client.query(sql.replaceAll('public.', 'pg_temp.'), params);
      } } },
    });
    t.after(() => databaseMock.restore());
    const { default: router } = await import('../src/modules/collections/collections.routes.js');
    const previousSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'collections-test-secret';
    t.after(() => {
      if (previousSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previousSecret;
    });
    const token = jwt.sign({ sub: userId, authzVersion: 1 }, process.env.JWT_SECRET);
    const app = express();
    app.use(express.json());
    app.use('/api/collections', router);
    app.use(errorHandler);
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => server.close(resolve)));
    async function request(body, bearer = token) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/collections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, ...await response.json() };
    }
    async function role(name) {
      await client.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
      await client.query('INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name = $2', [userId, name]);
    }
    const body = { title: ' Collection ', description: ' Description ' };
    assert.equal((await request(body, null)).status, 401);
    assert.equal((await request(body, 'invalid')).status, 401);
    assert.equal((await request(body, jwt.sign({ sub: userId, purpose: 'two_factor' }, process.env.JWT_SECRET))).status, 401);
    await role('Viewer');
    const denied = await request(body);
    assert.equal(denied.status, 403);
    assert.equal(denied.requiredPermission, 'collections.create');
    assert.equal(await count('collections'), 0);

    for (const name of ['Uploader', 'Administrator', 'Owner']) {
      await role(name);
      const created = await request(body);
      assert.equal(created.status, 201);
      assert.equal(created.success, true);
      assert.equal(created.collection.title, 'Collection');
      assert.equal(created.collection.description, 'Description');
      assert.equal(created.collection.created_by, userId);
      assert.equal(created.collection.thumbnail_url, null);
      const saved = (await client.query('SELECT * FROM collections WHERE id = $1', [created.collection.id])).rows[0];
      assert.deepEqual(created.collection, JSON.parse(JSON.stringify(saved)));
    }
    await role('Uploader');
    assert.equal((await request({ title: 'Minimal' })).collection.description, null);
    const before = await count('collections');
    for (const invalid of [undefined, null, {}, { title: ' ' }, { title: 'x'.repeat(256) },
      { title: 'Collection', description: 123 }, { title: 'Collection', created_by: randomUUID() },
      { title: 'Collection', thumbnail_url: 'https://example.com/image.jpg' }, { title: 'Collection', playlist_ids: [] },
    ]) assert.equal((await request(invalid)).status, 400);
    assert.equal(await count('collections'), before);
    assert.equal(await count('collection_playlists'), 0);

    await client.query(`UPDATE role_permissions SET effect = 'deny'
      WHERE role_id = (SELECT id FROM roles WHERE name = 'Uploader')
      AND permission_id = (SELECT id FROM permissions WHERE key = 'collections.create')`);
    await client.query("INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name = 'Administrator'", [userId]);
    assert.equal((await request(body)).status, 403);
    assert.equal(await count('collections'), before);

    await role('Administrator');
    failInsert = true;
    const errorsBefore = errorLog.mock.callCount();
    const failed = await request(body);
    assert.deepEqual(failed, { status: 500, success: false, message: 'Unable to process the collection request' });
    assert.equal(errorLog.mock.callCount(), errorsBefore + 1);
    assert.equal(await count('collections'), before);
  });
});
