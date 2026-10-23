import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';
import * as repository from '../src/modules/certificates/certificate-templates/repository/certificate-templates.repository.js';
import { createCertificateTemplateSchema } from '../src/modules/certificates/certificate-templates/helpers/certificate-templates.validation.js';

test('Certificate Moderation migration grants administrators, uploaders and owners, preserves overrides and rolls back cleanly', {
  skip: !process.env.TEST_DATABASE_URL,
}, async t => {
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  await client.connect();
  t.after(() => client.end());
  await client.query(`
    SET search_path TO pg_temp;
    CREATE TEMP TABLE permissions (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, key text NOT NULL UNIQUE,
      description text NOT NULL, group_name text NOT NULL, resource_type text, risk_level text NOT NULL
    );
    CREATE TEMP TABLE roles (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name text UNIQUE, is_owner boolean DEFAULT false
    );
    CREATE TEMP TABLE role_permissions (
      role_id bigint REFERENCES roles(id) ON DELETE CASCADE,
      permission_id bigint REFERENCES permissions(id) ON DELETE CASCADE,
      effect text NOT NULL CHECK (effect IN ('allow', 'deny')), PRIMARY KEY (role_id, permission_id)
    );
    INSERT INTO roles (name, is_owner) VALUES
      ('Viewer', false), ('Uploader', false), ('Administrator', false), ('Owner', true), ('Custom', false);
    INSERT INTO permissions (key, description, group_name, risk_level)
      VALUES ('unrelated.permission', 'Unrelated permission', 'Other', 'normal');
    INSERT INTO role_permissions SELECT r.id, p.id, 'allow' FROM roles r CROSS JOIN permissions p;
  `);
  const migration = await readFile(new URL('../src/database/migrations/1792713600003_add-certificate-moderation-permission.sql', import.meta.url), 'utf8');
  const [up, down] = migration.split('-- Down Migration');
  await client.query(up);
  await client.query(up);
  const permission = (await client.query("SELECT * FROM permissions WHERE key = 'certificates.moderate'")).rows[0];
  assert.equal(permission.description, 'Certificate Moderation');
  assert.equal(permission.group_name, 'Certificates');
  assert.equal(permission.resource_type, 'certificate_template');
  assert.equal(permission.risk_level, 'sensitive');
  const grantsSql = `SELECT r.name, rp.effect FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
    WHERE rp.permission_id = $1 ORDER BY r.name`;
  assert.deepEqual((await client.query(grantsSql, [permission.id])).rows, [
    { name: 'Administrator', effect: 'allow' }, { name: 'Owner', effect: 'allow' },
    { name: 'Uploader', effect: 'allow' },
  ]);
  await client.query(`UPDATE role_permissions SET effect = 'deny'
    WHERE permission_id = $1 AND role_id = (SELECT id FROM roles WHERE name = 'Administrator')`, [permission.id]);
  await client.query(`INSERT INTO role_permissions SELECT id, $1, 'allow' FROM roles WHERE name = 'Custom'`, [permission.id]);
  await client.query(up);
  assert.deepEqual((await client.query(grantsSql, [permission.id])).rows, [
    { name: 'Administrator', effect: 'deny' }, { name: 'Custom', effect: 'allow' }, { name: 'Owner', effect: 'allow' },
    { name: 'Uploader', effect: 'allow' },
  ]);
  await client.query(down);
  assert.deepEqual((await client.query('SELECT key FROM permissions')).rows, [{ key: 'unrelated.permission' }]);
  assert.equal((await client.query(grantsSql, [permission.id])).rows.length, 0);
  assert.equal((await client.query('SELECT * FROM role_permissions')).rows.length, 5);
});

test('certificate template migration and repository enforce ownership, filters, pagination, updates and cascade deletion', {
  skip: !process.env.TEST_DATABASE_URL,
}, async t => {
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  await client.connect();
  t.after(() => client.end());
  await client.query('CREATE TEMP TABLE users (id uuid PRIMARY KEY)');
  const migration = await readFile(new URL('../src/database/migrations/1792627200002_add-certificate-templates.sql', import.meta.url), 'utf8');
  const [up, down] = migration.replaceAll('public.', 'pg_temp.').split('-- Down Migration');
  await client.query(up);
  const userId = randomUUID(), otherUserId = randomUUID();
  await client.query('INSERT INTO pg_temp.users(id) VALUES ($1),($2)', [userId, otherUserId]);
  const legacy = (await client.query("INSERT INTO pg_temp.certificate_templates(user_id,name,html_template) VALUES ($1,'Legacy','<p>Passed</p>') RETURNING *", [userId])).rows[0];
  const systemMigration = await readFile(new URL('../src/database/migrations/1792713600000_add-system-certificate-templates.sql', import.meta.url), 'utf8');
  const [systemUp, systemDown] = systemMigration.replaceAll('public.', 'pg_temp.').split('-- Down Migration');
  await client.query(systemUp);
  const migratedLegacy = (await client.query('SELECT * FROM pg_temp.certificate_templates WHERE id=$1', [legacy.id])).rows[0];
  assert.deepEqual(migratedLegacy, { ...legacy, is_system: false, is_default: false });
  await client.query('DELETE FROM pg_temp.certificate_templates WHERE id=$1', [legacy.id]);
  const system = (await client.query('SELECT * FROM pg_temp.certificate_templates WHERE is_default=true')).rows[0];
  assert.equal(system.name, 'Classic');
  assert.equal(system.user_id, null);
  assert.equal(system.is_system, true);
  assert.equal(system.page_format, 'Letter');
  assert.equal(system.orientation, 'landscape');
  const database = { query: (sql, params) => client.query(sql.replaceAll('public.', 'pg_temp.'), params) };
  const make = (name, changes = {}) => createCertificateTemplateSchema.parse({ name, html_template: '<h1>Passed</h1>', ...changes });
  const first = await repository.createCertificateTemplate(database, userId, make('Alpha 100%_'));
  const second = await repository.createCertificateTemplate(database, userId, make('Beta', { page_format: 'Letter', orientation: 'portrait' }));
  const hidden = await repository.createCertificateTemplate(database, otherUserId, make('Hidden'));
  assert.equal(first.user_id, userId);
  assert.equal(first.css_template, '');
  assert.equal(first.page_format, 'A4');
  assert.equal(first.orientation, 'landscape');
  assert.equal(first.description, null);
  assert.equal(first.is_system, false);
  assert.equal(first.is_default, false);
  assert.ok(first.created_at instanceof Date);
  assert.ok(first.updated_at instanceof Date);
  assert.equal((await repository.getCertificateTemplate(database, first.id, userId)).id, first.id);
  assert.equal(await repository.getCertificateTemplate(database, first.id, otherUserId), null);
  assert.equal(await repository.updateCertificateTemplate(database, first.id, otherUserId, { name: 'Stolen' }), null);
  assert.equal(await repository.deleteCertificateTemplate(database, first.id, otherUserId), false);
  for (const viewer of [userId, otherUserId]) {
    assert.equal((await repository.getCertificateTemplate(database, system.id, viewer)).id, system.id);
    assert.equal(await repository.updateCertificateTemplate(database, system.id, viewer, { name: 'Changed' }), null);
    assert.equal(await repository.deleteCertificateTemplate(database, system.id, viewer), false);
  }
  const options = { limit: 1, offset: 0, sortBy: 'name', sortOrder: 'desc' };
  const page = await repository.listCertificateTemplates(database, userId, options);
  assert.equal(page.total, 3);
  assert.deepEqual(page.templates.map(template => template.id), [system.id]);
  const next = await repository.listCertificateTemplates(database, userId, { ...options, offset: 1 });
  assert.deepEqual(next.templates.map(template => template.id), [second.id]);
  const beyond = await repository.listCertificateTemplates(database, userId, { ...options, offset: 100 });
  assert.deepEqual(beyond, { templates: [], total: 3 });
  const filtered = await repository.listCertificateTemplates(database, userId, {
    ...options, name: '100%_', page_format: 'A4', orientation: 'landscape',
  });
  assert.equal(filtered.total, 1);
  assert.equal(filtered.templates[0].id, first.id);
  const systemFiltered = await repository.listCertificateTemplates(database, userId, {
    ...options, name: 'class', page_format: 'Letter', orientation: 'landscape',
  });
  assert.deepEqual(systemFiltered.templates.map(row => row.id), [system.id]);
  assert.equal(systemFiltered.total, 1);
  assert.equal((await repository.listCertificateTemplates(database, userId, { ...options, name: 'Classic', page_format: 'A4' })).total, 0);
  assert.deepEqual(await repository.listCertificateTemplates(database, userId, { ...options, name: "' OR true --" }), { templates: [], total: 0 });
  const updated = await repository.updateCertificateTemplate(database, first.id, userId, { css_template: '.x { color: red }', description: null });
  assert.equal(updated.css_template, '.x { color: red }');
  assert.equal(updated.html_template, first.html_template);
  assert.equal(updated.name, first.name);
  assert.ok(updated.updated_at >= first.updated_at);
  const cleared = await repository.updateCertificateTemplate(database, first.id, userId, { css_template: '' });
  assert.equal(cleared.css_template, '');
  for (const [field, value] of [['html_template', '   '], ['page_format', 'A3'], ['orientation', 'diagonal']]) {
    await assert.rejects(client.query(`UPDATE pg_temp.certificate_templates SET ${field}=$1 WHERE id=$2`, [value, first.id]), { code: '23514' });
  }
  assert.equal(await repository.deleteCertificateTemplate(database, second.id, userId), true);
  assert.equal(await repository.deleteCertificateTemplate(database, second.id, userId), false);
  await client.query('DELETE FROM pg_temp.users WHERE id=$1', [userId]);
  assert.equal(await repository.getCertificateTemplate(database, first.id, userId), null);
  assert.equal((await repository.listCertificateTemplates(database, otherUserId, options)).total, 2);
  assert.equal((await repository.getCertificateTemplate(database, system.id, otherUserId)).id, system.id);
  await assert.rejects(client.query('UPDATE pg_temp.certificate_templates SET user_id=NULL WHERE id=$1', [hidden.id]), { code: '23514' });
  await assert.rejects(client.query('UPDATE pg_temp.certificate_templates SET user_id=$1 WHERE id=$2', [otherUserId, system.id]), { code: '23514' });
  await assert.rejects(client.query('UPDATE pg_temp.certificate_templates SET is_default=true WHERE id=$1', [hidden.id]), { code: '23514' });
  await assert.rejects(client.query("INSERT INTO pg_temp.certificate_templates(is_system,is_default,name,html_template) VALUES (true,true,'Second default','<p>X</p>')"), { code: '23505' });
  const modern = (await client.query("INSERT INTO pg_temp.certificate_templates(is_system,name,html_template) VALUES (true,'Modern','<p>X</p>') RETURNING *")).rows[0];
  assert.equal(modern.is_default, false);
  assert.equal((await repository.listCertificateTemplates(database, otherUserId, { ...options, limit: 100 })).total, 3);
  await client.query('BEGIN');
  await client.query('UPDATE pg_temp.certificate_templates SET is_default=false WHERE id=$1', [system.id]);
  await client.query('UPDATE pg_temp.certificate_templates SET is_default=true WHERE id=$1', [modern.id]);
  await client.query('COMMIT');
  assert.equal((await client.query('SELECT id FROM pg_temp.certificate_templates WHERE is_default=true')).rows[0].id, modern.id);
  await client.query(systemDown);
  const { is_system, is_default, ...expectedPrivate } = hidden;
  assert.deepEqual((await client.query('SELECT * FROM pg_temp.certificate_templates')).rows, [expectedPrivate]);
  await assert.rejects(client.query("INSERT INTO pg_temp.certificate_templates(name,html_template) VALUES ('No owner','<p>X</p>')"), { code: '23502' });
  await client.query(systemUp);
  assert.equal((await client.query('SELECT count(*)::integer AS count FROM pg_temp.certificate_templates WHERE is_default=true')).rows[0].count, 1);
  const beforeMinimal = (await client.query('SELECT * FROM pg_temp.certificate_templates ORDER BY id')).rows;
  const minimalMigration = await readFile(new URL('../src/database/migrations/1792713600001_add-minimal-certificate-template.sql', import.meta.url), 'utf8');
  const [minimalUp, minimalDown] = minimalMigration.replaceAll('public.', 'pg_temp.').split('-- Down Migration');
  await client.query(minimalUp);
  const minimal = (await client.query("SELECT * FROM pg_temp.certificate_templates WHERE name='Minimal'")).rows[0];
  assert.equal(minimal.user_id, null);
  assert.equal(minimal.is_system, true);
  assert.equal(minimal.is_default, false);
  assert.equal(minimal.page_format, 'Letter');
  assert.equal(minimal.orientation, 'landscape');
  assert.deepEqual((await client.query('SELECT name FROM pg_temp.certificate_templates WHERE is_default=true')).rows, [{ name: 'Classic' }]);
  assert.equal((await repository.getCertificateTemplate(database, minimal.id, otherUserId)).id, minimal.id);
  assert.equal(await repository.updateCertificateTemplate(database, minimal.id, otherUserId, { name: 'Changed' }), null);
  assert.equal(await repository.deleteCertificateTemplate(database, minimal.id, otherUserId), false);
  const minimalList = await repository.listCertificateTemplates(database, otherUserId, { ...options, name: 'Minimal' });
  assert.equal(minimalList.total, 1);
  assert.equal(minimalList.templates[0].id, minimal.id);
  const beforeModern = (await client.query('SELECT * FROM pg_temp.certificate_templates ORDER BY id')).rows;
  const modernMigration = await readFile(new URL('../src/database/migrations/1792713600002_add-modern-certificate-template.sql', import.meta.url), 'utf8');
  const [modernUp, modernDown] = modernMigration.replaceAll('public.', 'pg_temp.').split('-- Down Migration');
  await client.query(modernUp);
  const modernTemplate = (await client.query("SELECT * FROM pg_temp.certificate_templates WHERE name='Modern'")).rows[0];
  assert.equal(modernTemplate.user_id, null);
  assert.equal(modernTemplate.is_system, true);
  assert.equal(modernTemplate.is_default, false);
  assert.equal(modernTemplate.page_format, 'Letter');
  assert.equal(modernTemplate.orientation, 'landscape');
  assert.deepEqual((await client.query('SELECT name FROM pg_temp.certificate_templates WHERE is_default=true')).rows, [{ name: 'Classic' }]);
  assert.equal((await repository.getCertificateTemplate(database, modernTemplate.id, otherUserId)).id, modernTemplate.id);
  assert.equal(await repository.updateCertificateTemplate(database, modernTemplate.id, otherUserId, { name: 'Changed' }), null);
  assert.equal(await repository.deleteCertificateTemplate(database, modernTemplate.id, otherUserId), false);
  const modernList = await repository.listCertificateTemplates(database, otherUserId, { ...options, name: 'Modern' });
  assert.equal(modernList.total, 1);
  assert.equal(modernList.templates[0].id, modernTemplate.id);
  await client.query(modernDown);
  assert.deepEqual((await client.query('SELECT * FROM pg_temp.certificate_templates ORDER BY id')).rows, beforeModern);
  await client.query(minimalDown);
  assert.deepEqual((await client.query('SELECT * FROM pg_temp.certificate_templates ORDER BY id')).rows, beforeMinimal);
  await client.query(down);
  assert.equal((await client.query("SELECT to_regclass('pg_temp.certificate_templates') AS table_name")).rows[0].table_name, null);
});
