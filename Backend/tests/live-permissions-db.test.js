import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { prepareLivePermissions, livePermissionsMigration } from './helpers/live-permissions-schema.js';

test('livestream permissions migration and HTTP authorization', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  await client.connect(); t.after(() => client.end());
  await client.query(`CREATE TEMP TABLE users (id uuid PRIMARY KEY, status text DEFAULT 'active', authz_version integer DEFAULT 1);
    CREATE TEMP TABLE live_streams (id uuid PRIMARY KEY, user_id uuid REFERENCES pg_temp.users(id));`);
  const uuid = n => `12345678-1234-4234-8234-${String(n).padStart(12, '0')}`;
  const uploader = uuid(1), other = uuid(2), admin = uuid(3), owner = uuid(4), viewer = uuid(5), live = uuid(6);
  await client.query('INSERT INTO pg_temp.users(id) SELECT unnest($1::uuid[])', [[uploader, other, admin, owner, viewer]]);
  await client.query('INSERT INTO pg_temp.live_streams VALUES ($1,$2)', [live, uploader]);
  await prepareLivePermissions(client, [uploader, other]);
  for (const [user, role] of [[admin, 'Administrator'], [owner, 'Owner'], [viewer, 'Viewer']]) {
    await client.query('INSERT INTO pg_temp.user_roles(user_id,role_id) SELECT $1,id FROM pg_temp.roles WHERE name=$2', [user, role]);
  }
  let calls = [], uploads = 0;
  mock.module(new URL('../src/database/index.js', import.meta.url).href, { namedExports: { writePool: {
    query(sql, values) { return client.query(sql.replaceAll('public.', 'pg_temp.'), values); },
  } } });
  // Exercise the real routes, controllers, auth middleware and permission SQL.
  // Stub business handlers so no authorized operation mutates external resources.
  for (const name of ['createLiveStream', 'getMyLiveStreams', 'getUserLiveCards', 'updateLiveDetails',
    'liveThumbnailUpload', 'getStreamingDetails', 'getLivePlayback', 'getLiveDetails', 'deleteLiveStream']) {
    mock.module(new URL(`../src/modules/live-streams/handlers/${name}.js`, import.meta.url).href, {
      namedExports: { [`${name}Internal`]: async (...args) => { calls.push({ name, args }); return { handled: name }; } },
    });
  }
  mock.module(new URL('../src/modules/live-streams/live-streams.middleware.js', import.meta.url).href, {
    namedExports: { liveThumbnailUploadMiddleware(req, res, next) { uploads++; next(); } },
  });
  const { default: router } = await import('../src/modules/live-streams/live-streams.routes.js');
  const oldSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'live-permissions-test';
  t.after(() => { if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret; });
  const app = express(); app.use(express.json()); app.use('/api/live-streams', router);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/live-streams`;
  async function request(method, path, user, body) {
    calls = []; uploads = 0;
    return fetch(base + path, { method, headers: {
      ...(user ? { Authorization: `Bearer ${jwt.sign({ sub: user, purpose: 'access' }, process.env.JWT_SECRET)}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}) });
  }
  const management = [['PATCH', `/${live}`, 'updateLiveDetails'], ['POST', `/${live}/thumbnail`, 'liveThumbnailUpload'],
    ['DELETE', `/${live}`, 'deleteLiveStream'], ['GET', `/${live}/streaming-details`, 'getStreamingDetails']];

  await t.test('migration grants the exact defaults and preserves existing denies when repeated', async () => {
    assert.equal((await client.query('SELECT * FROM pg_temp.permissions')).rowCount, 7);
    const grants = async role => (await client.query(`SELECT p.key FROM pg_temp.role_permissions rp
      JOIN pg_temp.roles r ON r.id=rp.role_id JOIN pg_temp.permissions p ON p.id=rp.permission_id
      WHERE r.name=$1 ORDER BY p.key`, [role])).rows.map(r => r.key);
    assert.deepEqual(await grants('Uploader'), ['live_streams.create', 'live_streams.delete_own', 'live_streams.stream_own', 'live_streams.update_own']);
    assert.equal((await grants('Administrator')).length, 7);
    for (const role of ['Owner', 'Viewer', 'Moderator']) assert.deepEqual(await grants(role), []);
    await client.query(`UPDATE pg_temp.role_permissions SET effect='deny' WHERE role_id=(SELECT id FROM pg_temp.roles WHERE name='Uploader')
      AND permission_id=(SELECT id FROM pg_temp.permissions WHERE key='live_streams.create')`);
    await client.query('SET search_path TO pg_temp');
    await client.query(livePermissionsMigration.split('-- Down Migration')[0]);
    assert.equal((await request('POST', '/', uploader)).status, 403); assert.deepEqual(calls, []);
    await client.query("UPDATE pg_temp.role_permissions SET effect='allow'");
    await client.query('SET search_path TO pg_temp, public');
  });

  await t.test('create and own library require their specific livestream permissions', async () => {
    for (const [method, path] of [['POST', '/'], ['GET', '/my/lives']]) {
      assert.equal((await request(method, path)).status, 401); assert.deepEqual(calls, []);
      assert.equal((await request(method, path, viewer)).status, 403); assert.deepEqual(calls, []);
      assert.equal((await request(method, path, uploader)).status, method === 'POST' ? 201 : 200);
      assert.equal(calls[0].args[1], uploader);
    }
  });

  await t.test('own permissions allow owned resources and stop cross-user requests before handlers or upload parsing', async () => {
    for (const [method, path, handler] of management) {
      assert.equal((await request(method, path)).status, 401); assert.deepEqual(calls, []);
      assert.equal((await request(method, path, other)).status, 403); assert.deepEqual(calls, []); assert.equal(uploads, 0);
      assert.equal((await request(method, path, viewer)).status, 403); assert.deepEqual(calls, []);
      assert.equal((await request(method, path, uploader)).status, 200);
      assert.equal(calls[0].name, handler); assert.equal(calls[0].args[1], uploader);
    }
  });

  await t.test('any permissions and platform Owner reach handlers with the authorized resource scope', async () => {
    for (const actor of [admin, owner]) for (const [method, path, handler] of management) {
      assert.equal((await request(method, path, actor)).status, 200);
      assert.equal(calls[0].name, handler); assert.equal(calls[0].args[1], uploader);
    }
    // Management scope is never taken from the body/query or used as the viewer's identity.
    assert.equal((await request('PATCH', `/${live}?owner_id=${uploader}`, other,
      { owner_id: uploader, resourceAccess: { canAccessAny: true } })).status, 403);
    assert.deepEqual(calls, []);
    assert.equal((await request('GET', '/my/lives', admin)).status, 200);
    assert.equal(calls[0].args[1], admin);
  });

  await t.test('explicit denies override allows; expired roles do not authorize requests', async () => {
    const role = (await client.query("INSERT INTO pg_temp.roles(name,position) VALUES ('Restricted',5) RETURNING id")).rows[0].id;
    await client.query("INSERT INTO pg_temp.role_permissions SELECT $1,id,'deny' FROM pg_temp.permissions WHERE key='live_streams.update_own'", [role]);
    await client.query('INSERT INTO pg_temp.user_roles(user_id,role_id) VALUES ($1,$2)', [uploader, role]);
    assert.equal((await request('PATCH', `/${live}`, uploader)).status, 403); assert.deepEqual(calls, []);
    await client.query('DELETE FROM pg_temp.user_roles WHERE role_id=$1', [role]);
    await client.query("UPDATE pg_temp.user_roles SET expires_at=now()-interval '1 second' WHERE user_id=$1", [uploader]);
    assert.equal((await request('GET', `/${live}/streaming-details`, uploader)).status, 403); assert.deepEqual(calls, []);
    await client.query('UPDATE pg_temp.user_roles SET expires_at=NULL WHERE user_id=$1', [uploader]);
  });

  await t.test('editing does not grant encoder credentials; missing and malformed resources stop early', async () => {
    await client.query(`UPDATE pg_temp.role_permissions SET effect='deny' WHERE role_id=(SELECT id FROM pg_temp.roles WHERE name='Administrator')
      AND permission_id=(SELECT id FROM pg_temp.permissions WHERE key='live_streams.stream_any')`);
    assert.equal((await request('PATCH', `/${live}`, admin)).status, 200);
    assert.equal((await request('GET', `/${live}/streaming-details`, admin)).status, 403); assert.deepEqual(calls, []);
    assert.equal((await request('GET', `/${live}/streaming-details`, owner)).status, 200);
    assert.equal((await request('PATCH', '/invalid', admin)).status, 400); assert.deepEqual(calls, []);
    assert.equal((await request('DELETE', `/${uuid(99)}`, admin)).status, 404); assert.deepEqual(calls, []);
  });

  await t.test('viewing routes retain authentication and visibility handling without management permissions', async () => {
    assert.equal((await request('GET', `/users/${uploader}/cards`)).status, 200);
    for (const [method, path] of [['GET', `/${live}`], ['POST', `/${live}/playback`]]) {
      assert.equal((await request(method, path)).status, 401);
      assert.equal((await request(method, path, viewer)).status, 200);
      assert.equal(calls[0].args[1], viewer);
    }
  });

  await t.test('down migration removes only livestream permissions and cascades their role grants', async () => {
    await client.query("INSERT INTO pg_temp.permissions(key,description,group_name,risk_level) VALUES ('videos.create','existing','Videos','normal')");
    await client.query('SET search_path TO pg_temp');
    await client.query(livePermissionsMigration.split('-- Down Migration')[1]);
    assert.deepEqual((await client.query('SELECT key FROM pg_temp.permissions')).rows, [{ key: 'videos.create' }]);
    assert.equal((await client.query('SELECT * FROM pg_temp.role_permissions')).rowCount, 0);
  });
});
