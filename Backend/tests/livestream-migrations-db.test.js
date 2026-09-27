import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';
import { Permissions } from '../src/modules/authorization/permission.constants.js';

const uuid = n => `12345678-1234-4234-8234-${String(n).padStart(12, '0')}`;
async function migration(name) {
  const sql = await readFile(new URL(`../src/database/migrations/${name}.sql`, import.meta.url), 'utf8');
  const [up, down] = sql.replaceAll('public.', 'pg_temp.').split('-- Down Migration');
  return { up, down };
}

test('livestream migrations against isolated PostgreSQL temporary tables', {
  skip: !process.env.TEST_DATABASE_URL,
}, async t => {
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  await client.connect();
  t.after(() => client.end());
  await client.query('SET search_path = pg_temp, pg_catalog');
  await client.query(`
    CREATE TEMP TABLE videos (id uuid PRIMARY KEY, title text);
    CREATE TEMP TABLE permissions (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, key text UNIQUE NOT NULL,
      description text, group_name text, resource_type text, risk_level text
    );
    CREATE TEMP TABLE roles (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name text UNIQUE NOT NULL);
    CREATE TEMP TABLE role_permissions (
      role_id bigint REFERENCES roles(id), permission_id bigint REFERENCES permissions(id) ON DELETE CASCADE,
      effect text, PRIMARY KEY (role_id, permission_id)
    );
    INSERT INTO roles(name) VALUES ('Viewer'),('Uploader'),('Moderator'),('Administrator'),('Owner'),('Custom');
  `);
  await client.query('INSERT INTO videos VALUES ($1,$2)', [uuid(1), 'Existing upload']);
  const schema = await migration('1790467200000_add-video-livestreams');
  const permissions = await migration('1790467200001_add-livestream-permissions');
  await client.query(schema.up);

  await t.test('existing and new uploaded videos retain the upload default', async () => {
    await client.query('INSERT INTO videos(id,title) VALUES ($1,$2)', [uuid(2), 'New upload']);
    assert.deepEqual((await client.query('SELECT DISTINCT kind FROM videos')).rows, [{ kind: 'upload' }]);
    await assert.rejects(client.query("UPDATE videos SET kind='unknown' WHERE id=$1", [uuid(1)]), { code: '23514' });
    await assert.rejects(client.query('UPDATE videos SET kind=NULL WHERE id=$1', [uuid(1)]), { code: '23502' });
  });

  await t.test('one live record per live parent, with database-enforced type and cascade', async () => {
    await assert.rejects(client.query("INSERT INTO video_livestreams(video_id,mode,max_duration_seconds) VALUES ($1,'standard',43200)", [uuid(1)]), { code: '23503' });
    await client.query("INSERT INTO videos(id,kind) VALUES ($1,'live'),($2,'live')", [uuid(3), uuid(4)]);
    await client.query("INSERT INTO video_livestreams(video_id,mode,max_duration_seconds,mux_live_stream_id) VALUES ($1,'dvr',14300,'mux-live-1')", [uuid(3)]);
    await assert.rejects(client.query("INSERT INTO video_livestreams(video_id,mode,max_duration_seconds) VALUES ($1,'dvr',100)", [uuid(3)]), { code: '23505' });
    await assert.rejects(client.query("INSERT INTO video_livestreams(video_id,mode,max_duration_seconds,mux_live_stream_id) VALUES ($1,'standard',43200,'mux-live-1')", [uuid(4)]), { code: '23505' });
    await assert.rejects(client.query("UPDATE videos SET kind='upload' WHERE id=$1", [uuid(3)]), { code: '23503' });
    await client.query("INSERT INTO video_livestreams(video_id,mode,max_duration_seconds) VALUES ($1,'standard',43200)", [uuid(4)]);
    await client.query('DELETE FROM videos WHERE id=$1', [uuid(4)]);
    assert.equal((await client.query('SELECT * FROM video_livestreams WHERE video_id=$1', [uuid(4)])).rowCount, 0);
  });

  await t.test('DVR must be strictly below four hours and have valid settings', async () => {
    for (const duration of [0, -1, 14400, 14401]) {
      await assert.rejects(client.query('UPDATE video_livestreams SET max_duration_seconds=$1 WHERE video_id=$2', [duration, uuid(3)]), { code: '23514' });
    }
    await assert.rejects(client.query('UPDATE video_livestreams SET max_duration_seconds=NULL'), { code: '23502' });
    await assert.rejects(client.query("UPDATE video_livestreams SET mode='other'"), { code: '23514' });
    await assert.rejects(client.query("UPDATE video_livestreams SET status='other'"), { code: '23514' });
    await client.query('UPDATE video_livestreams SET max_duration_seconds=14399');
    assert.equal((await client.query('SELECT status FROM video_livestreams')).rows[0].status, 'scheduled');
  });

  await t.test('permissions match constants, seed expected roles and preserve existing denials', async () => {
    await client.query("INSERT INTO permissions(key) VALUES ('livestreams.broadcast_own')");
    await client.query("INSERT INTO role_permissions SELECT r.id,p.id,'deny' FROM roles r CROSS JOIN permissions p WHERE r.name='Uploader'");
    await client.query(permissions.up);
    await client.query(permissions.up);
    const expected = Object.values(Permissions).filter(key => key.startsWith('livestreams.')).sort();
    assert.deepEqual((await client.query('SELECT key FROM permissions ORDER BY key')).rows.map(row => row.key), expected);
    const assigned = async role => (await client.query(`
      SELECT p.key,rp.effect FROM role_permissions rp JOIN roles r ON r.id=rp.role_id
      JOIN permissions p ON p.id=rp.permission_id WHERE r.name=$1 ORDER BY p.key`, [role])).rows;
    assert.equal((await assigned('Administrator')).length, expected.length);
    assert.equal((await assigned('Viewer')).length, 3);
    assert.equal((await assigned('Uploader')).length, 4);
    assert.equal((await assigned('Uploader')).find(row => row.key === 'livestreams.broadcast_own').effect, 'deny');
    assert.deepEqual(await assigned('Custom'), []);
    assert.deepEqual(await assigned('Moderator'), []);
    await client.query(permissions.down);
    assert.equal((await client.query('SELECT * FROM permissions')).rowCount, 0);
    assert.equal((await client.query('SELECT * FROM role_permissions')).rowCount, 0);
  });

  await t.test('lifecycle migration preserves explicit analytics grants and denies and rolls back cleanly', async () => {
    await client.query('CREATE TEMP TABLE video_views (id uuid PRIMARY KEY)');
    await client.query("INSERT INTO permissions(key) VALUES ('analytics.video_own.read'), ('analytics.video_any.read'), ('analytics.livestream_own.read')");
    await client.query(`INSERT INTO role_permissions SELECT r.id,p.id,'allow'
      FROM roles r CROSS JOIN permissions p WHERE r.name='Uploader' AND p.key='analytics.video_own.read'`);
    await client.query(`INSERT INTO role_permissions SELECT r.id,p.id,'deny'
      FROM roles r CROSS JOIN permissions p WHERE r.name='Uploader' AND p.key='analytics.livestream_own.read'`);
    await client.query(`INSERT INTO role_permissions SELECT r.id,p.id,'allow'
      FROM roles r CROSS JOIN permissions p WHERE r.name='Administrator' AND p.key='analytics.video_any.read'`);
    const lifecycle = await migration('1790467200002_livestream-lifecycle');
    await client.query(lifecycle.up);
    const effects = (await client.query(`SELECT p.key,rp.effect FROM role_permissions rp
      JOIN permissions p ON p.id=rp.permission_id WHERE p.key LIKE 'analytics.livestream%' ORDER BY p.key`)).rows;
    assert.deepEqual(effects, [
      { key: 'analytics.livestream_any.read', effect: 'allow' },
      { key: 'analytics.livestream_own.read', effect: 'deny' },
    ]);
    assert.equal((await client.query('SELECT policy_sync_pending FROM video_livestreams')).rows[0].policy_sync_pending, false);
    await client.query(lifecycle.down);
    assert.equal((await client.query("SELECT * FROM permissions WHERE key LIKE 'analytics.livestream%'")).rowCount, 0);
  });

  await t.test('rollback preserves live data by refusing removal, then succeeds when no lives remain', async () => {
    await assert.rejects(client.query(schema.down), /while live videos exist/);
    assert.equal((await client.query('SELECT * FROM video_livestreams')).rowCount, 1);
    await client.query("DELETE FROM videos WHERE kind='live'");
    await client.query(schema.down);
    assert.equal((await client.query("SELECT to_regclass('pg_temp.video_livestreams') AS name")).rows[0].name, null);
    assert.equal((await client.query('SELECT * FROM videos')).rowCount, 2);
    await client.query(schema.up);
    assert.deepEqual((await client.query('SELECT DISTINCT kind FROM videos')).rows, [{ kind: 'upload' }]);
  });
});
