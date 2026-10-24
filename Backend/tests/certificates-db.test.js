import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';

test('certificate issuance schema generates unique numbers, preserves snapshots and rolls back cleanly', {
  skip: !process.env.TEST_DATABASE_URL,
}, async t => {
  const schema = `certificates_test_${randomUUID().replaceAll('-', '')}`;
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 6,
    connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  const client = await pool.connect();
  t.after(async () => {
    try { await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
    finally { client.release(); await pool.end(); }
  });
  await client.query(`CREATE SCHEMA ${schema}`);
  // Parent-table fixtures isolate this migration from unrelated application setup.
  for (const table of ['users', 'quizzes', 'quiz_attempts', 'certificate_templates']) {
    await client.query(`CREATE TABLE ${schema}.${table} (id uuid PRIMARY KEY)`);
  }
  const [up, down] = (await readFile(new URL('../src/database/migrations/1792926000001_add-certificates.sql', import.meta.url), 'utf8'))
    .replaceAll('public.', `${schema}.`).split('-- Down Migration');
  await client.query(up);
  const userId = randomUUID(), quizId = randomUUID(), templateId = randomUUID();
  for (const [table, id] of [['users', userId], ['quizzes', quizId], ['certificate_templates', templateId]]) {
    await client.query(`INSERT INTO ${schema}.${table} VALUES ($1)`, [id]);
  }
  const data = { user: { full_name: 'John Anderson' }, result: { score_percentage: 95 } };
  const template = { html_template: '<h1>{{user.full_name}}</h1>', css_template: 'h1 {color:navy}', page_format: 'Letter' };
  const insertSql = `INSERT INTO ${schema}.certificates
    (user_id, quiz_id, quiz_attempt_id, certificate_template_id, data_snapshot, template_snapshot)
    VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`;
  const args = attemptId => [userId, quizId, attemptId, templateId, data, template];
  const attempt = async () => {
    const id = randomUUID();
    await client.query(`INSERT INTO ${schema}.quiz_attempts VALUES ($1)`, [id]);
    return id;
  };

  await t.test('defaults use UTC year, generated UUID/number/status/timestamps, and require both snapshots', async () => {
    await client.query("SET TIME ZONE 'Pacific/Kiritimati'");
    const year = (await client.query("SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY') AS year")).rows[0].year;
    const row = (await client.query(insertSql, args(await attempt()))).rows[0];
    assert.match(row.id, /^[a-f0-9-]{36}$/);
    assert.equal(row.certificate_number, `CERT-${year}-000001`);
    assert.equal(row.status, 'issued');
    assert.equal(row.revoked_at, null);
    assert.ok(row.issued_at instanceof Date);
    assert.equal(row.issued_at.getTime(), row.created_at.getTime());
    assert.deepEqual(row.data_snapshot, data);
    assert.deepEqual(row.template_snapshot, template);
    for (const field of ['data_snapshot', 'template_snapshot']) {
      await assert.rejects(client.query(`UPDATE ${schema}.certificates SET ${field}=NULL WHERE id=$1`, [row.id]), { code: '23502' });
    }
  });

  await t.test('parallel issuance assigns distinct numbers; attempt and number uniqueness are enforced', async () => {
    const ids = [];
    for (let index = 0; index < 12; index++) ids.push(await attempt());
    const rows = await Promise.all(ids.map(id => pool.query(insertSql, args(id)).then(result => result.rows[0])));
    assert.equal(new Set(rows.map(row => row.certificate_number)).size, ids.length);
    await assert.rejects(client.query(insertSql, args(ids[0])), { code: '23505', constraint: 'certificates_quiz_attempt_id_key' });
    await assert.rejects(client.query(`UPDATE ${schema}.certificates SET certificate_number=$1 WHERE id=$2`,
      [rows[0].certificate_number, rows[1].id]), { code: '23505', constraint: 'certificates_certificate_number_key' });
    await assert.rejects(client.query(`UPDATE ${schema}.certificates SET status='pending' WHERE id=$1`, [rows[0].id]), { code: '22P02' });
    const revoked = (await client.query(`UPDATE ${schema}.certificates SET status='revoked', revoked_at=now() WHERE id=$1 RETURNING *`, [rows[0].id])).rows[0];
    assert.equal(revoked.status, 'revoked');
    assert.ok(revoked.revoked_at instanceof Date);
  });

  await t.test('numbers grow beyond six digits and rolled-back issuance does not reuse a number', async () => {
    await client.query(`SELECT setval('${schema}.certificates_number_seq', 999999, true)`);
    const id = await attempt();
    await client.query('BEGIN');
    const rolledBack = (await client.query(insertSql, args(id))).rows[0];
    assert.match(rolledBack.certificate_number, /-1000000$/);
    await client.query('ROLLBACK');
    const committed = (await client.query(insertSql, args(id))).rows[0];
    assert.match(committed.certificate_number, /-1000001$/);
  });

  await t.test('foreign keys reject missing parents and template deletion preserves issued snapshots', async () => {
    const invalid = args(await attempt());
    for (const index of [0, 1, 2, 3]) {
      const values = [...invalid]; values[index] = randomUUID();
      await assert.rejects(client.query(insertSql, values), { code: '23503' });
    }
    const before = (await client.query(`SELECT * FROM ${schema}.certificates ORDER BY id`)).rows;
    for (const [table, id] of [['users', userId], ['quizzes', quizId], ['quiz_attempts', before[0].quiz_attempt_id]]) {
      await assert.rejects(client.query(`DELETE FROM ${schema}.${table} WHERE id=$1`, [id]), { code: '23503' });
    }
    await client.query(`DELETE FROM ${schema}.certificate_templates WHERE id=$1`, [templateId]);
    const after = (await client.query(`SELECT * FROM ${schema}.certificates ORDER BY id`)).rows;
    assert.deepEqual(after, before.map(row => ({ ...row, certificate_template_id: null })));
    const values = args(await attempt()); values[3] = null;
    assert.equal((await client.query(insertSql, values)).rows[0].certificate_template_id, null);
  });

  await client.query(down);
  const removed = (await client.query(`SELECT to_regclass('${schema}.certificates') AS certificates,
    to_regclass('${schema}.certificates_number_seq') AS sequence,
    to_regprocedure('${schema}.generate_certificate_number()') AS function,
    to_regtype('${schema}.certificate_status') AS status`)).rows[0];
  assert.deepEqual(removed, { certificates: null, sequence: null, function: null, status: null });
  assert.equal((await client.query(`SELECT count(*)::int AS count FROM ${schema}.users`)).rows[0].count, 1);
  await client.query(up);
  const restarted = (await client.query(`SELECT ${schema}.generate_certificate_number() AS number`)).rows[0].number;
  assert.match(restarted, /^CERT-\d{4}-000001$/);
});
