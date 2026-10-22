import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';
import * as repository from '../src/modules/certificates/certificate-templates/repository/certificate-templates.repository.js';
import { createCertificateTemplateSchema } from '../src/modules/certificates/certificate-templates/helpers/certificate-templates.validation.js';

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
  const database = { query: (sql, params) => client.query(sql.replaceAll('public.', 'pg_temp.'), params) };
  const make = (name, changes = {}) => createCertificateTemplateSchema.parse({ name, html_template: '<h1>Passed</h1>', ...changes });
  const first = await repository.createCertificateTemplate(database, userId, make('Alpha 100%_'));
  const second = await repository.createCertificateTemplate(database, userId, make('Beta', { page_format: 'Letter', orientation: 'portrait' }));
  await repository.createCertificateTemplate(database, otherUserId, make('Hidden'));
  assert.equal(first.user_id, userId);
  assert.equal(first.css_template, '');
  assert.equal(first.page_format, 'A4');
  assert.equal(first.orientation, 'landscape');
  assert.equal(first.description, null);
  assert.ok(first.created_at instanceof Date);
  assert.ok(first.updated_at instanceof Date);
  assert.equal((await repository.getCertificateTemplate(database, first.id, userId)).id, first.id);
  assert.equal(await repository.getCertificateTemplate(database, first.id, otherUserId), null);
  assert.equal(await repository.updateCertificateTemplate(database, first.id, otherUserId, { name: 'Stolen' }), null);
  assert.equal(await repository.deleteCertificateTemplate(database, first.id, otherUserId), false);
  const options = { limit: 1, offset: 0, sortBy: 'name', sortOrder: 'desc' };
  const page = await repository.listCertificateTemplates(database, userId, options);
  assert.equal(page.total, 2);
  assert.deepEqual(page.templates.map(template => template.id), [second.id]);
  const next = await repository.listCertificateTemplates(database, userId, { ...options, offset: 1 });
  assert.deepEqual(next.templates.map(template => template.id), [first.id]);
  const beyond = await repository.listCertificateTemplates(database, userId, { ...options, offset: 100 });
  assert.deepEqual(beyond, { templates: [], total: 2 });
  const filtered = await repository.listCertificateTemplates(database, userId, {
    ...options, name: '100%_', page_format: 'A4', orientation: 'landscape',
  });
  assert.equal(filtered.total, 1);
  assert.equal(filtered.templates[0].id, first.id);
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
  assert.equal((await repository.listCertificateTemplates(database, otherUserId, options)).total, 1);
  await client.query(down);
  assert.equal((await client.query("SELECT to_regclass('pg_temp.certificate_templates') AS table_name")).rows[0].table_name, null);
});
