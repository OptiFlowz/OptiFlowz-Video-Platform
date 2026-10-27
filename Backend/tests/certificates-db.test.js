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

  const [annualUp, annualDown] = (await readFile(new URL('../src/database/migrations/1792926000002_certificate-number-per-year.sql', import.meta.url), 'utf8'))
    .replaceAll('public.', `${schema}.`).split('-- Down Migration');
  const yearlyFunction = annualUp.slice(annualUp.indexOf('CREATE OR REPLACE FUNCTION'));
  // Simulate the database clock only in this isolated schema's function so the
  // real production SQL is exercised on both sides of a UTC year boundary.
  const atUtcTime = timestamp => client.query(yearlyFunction.replace("NOW() AT TIME ZONE 'UTC'", `TIMESTAMP '${timestamp}'`));
  const nextNumber = async (database = client) => (await database.query(`SELECT ${schema}.generate_certificate_number() AS number`)).rows[0].number;
  const valuesWithoutTemplate = id => { const values = args(id); values[3] = null; return values; };

  await t.test('annual migration preserves certificates and continues above existing numbers including revoked ones', async () => {
    const year = (await client.query("SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY') AS year")).rows[0].year;
    const values = valuesWithoutTemplate(await attempt());
    const manual = (await client.query(insertSql, values)).rows[0];
    await client.query(`UPDATE ${schema}.certificates SET certificate_number=$1,status='revoked',revoked_at=now() WHERE id=$2`,
      [`CERT-${year}-2000000`, manual.id]);
    const before = (await client.query(`SELECT * FROM ${schema}.certificates ORDER BY id`)).rows;
    await client.query(annualUp);
    assert.deepEqual((await client.query(`SELECT * FROM ${schema}.certificates ORDER BY id`)).rows, before);
    assert.equal((await client.query(insertSql, valuesWithoutTemplate(await attempt()))).rows[0].certificate_number, `CERT-${year}-2000001`);
  });

  await t.test('UTC New Year starts at one under concurrent issuance, with independent counters for older transactions', async () => {
    await atUtcTime('2098-12-31 23:59:59');
    assert.equal(await nextNumber(), 'CERT-2098-000001');
    assert.equal(await nextNumber(), 'CERT-2098-000002');
    await atUtcTime('2099-01-01 00:00:00');
    const ids = [];
    for (let index = 0; index < 12; index++) ids.push(await attempt());
    const numbers = await Promise.all(ids.map(id => pool.query(insertSql, valuesWithoutTemplate(id))
      .then(result => result.rows[0].certificate_number)));
    assert.deepEqual(numbers.sort(), Array.from({ length: 12 }, (_, i) => `CERT-2099-${String(i + 1).padStart(6, '0')}`));
    await atUtcTime('2098-12-31 23:59:59');
    assert.equal(await nextNumber(), 'CERT-2098-000003');
    await atUtcTime('2099-01-01 00:00:01');
    assert.equal(await nextNumber(), 'CERT-2099-000013');
    await client.query(yearlyFunction);
  });

  await t.test('yearly increments are transactional and expand beyond six digits', async () => {
    await atUtcTime('2099-06-01 12:00:00');
    await client.query(`UPDATE ${schema}.certificate_number_counters SET last_number=999999 WHERE year=2099`);
    const values = valuesWithoutTemplate(await attempt());
    await client.query('BEGIN');
    assert.equal((await client.query(insertSql, values)).rows[0].certificate_number, 'CERT-2099-1000000');
    await client.query('ROLLBACK');
    assert.equal((await client.query(insertSql, values)).rows[0].certificate_number, 'CERT-2099-1000000');
    assert.equal(await nextNumber(), 'CERT-2099-1000001');
    await client.query(yearlyFunction);
  });

  await t.test('annual migration rollback restores a safe global sequence and can be applied again', async () => {
    const before = (await client.query(`SELECT * FROM ${schema}.certificates ORDER BY id`)).rows;
    await client.query(annualDown);
    assert.equal((await client.query(`SELECT to_regclass('${schema}.certificate_number_counters') AS counters`)).rows[0].counters, null);
    assert.deepEqual((await client.query(`SELECT * FROM ${schema}.certificates ORDER BY id`)).rows, before);
    assert.match((await client.query(insertSql, valuesWithoutTemplate(await attempt()))).rows[0].certificate_number, /-2000002$/);
    await client.query(annualUp);
    assert.match((await client.query(insertSql, valuesWithoutTemplate(await attempt()))).rows[0].certificate_number, /-2000003$/);
    await client.query(annualDown);
  });

  const [attemptUp, attemptDown] = (await readFile(new URL('../src/database/migrations/1793059200000_certificate-attempt-on-delete-set-null.sql', import.meta.url), 'utf8'))
    .replaceAll('public.', `${schema}.`).split('-- Down Migration');
  await t.test('attempt deletion preserves issued and revoked certificates with nullable unique references', async () => {
    const before = (await client.query(`SELECT * FROM ${schema}.certificates ORDER BY id`)).rows;
    await client.query(attemptUp);
    assert.deepEqual((await client.query(`SELECT * FROM ${schema}.certificates ORDER BY id`)).rows, before);
    const targets = ['issued', 'revoked'].map(status => before.find(row => row.status === status));
    for (const row of targets) {
      await client.query(`DELETE FROM ${schema}.quiz_attempts WHERE id=$1`, [row.quiz_attempt_id]);
    }
    const expected = before.map(row => targets.includes(row) ? { ...row, quiz_attempt_id: null } : row);
    assert.deepEqual((await client.query(`SELECT * FROM ${schema}.certificates ORDER BY id`)).rows, expected);
    const remaining = before.find(row => !targets.includes(row));
    await assert.rejects(client.query(insertSql, valuesWithoutTemplate(remaining.quiz_attempt_id)), { code: '23505' });
    await assert.rejects(client.query(insertSql, valuesWithoutTemplate(randomUUID())), { code: '23503' });
    // Rollback must preserve orphaned certificates instead of deleting them.
    await assert.rejects(client.query(attemptDown), { code: '23502' });
    assert.deepEqual((await client.query(`SELECT * FROM ${schema}.certificates ORDER BY id`)).rows, expected);
    // Restore only test fixtures to verify the reversible path as well.
    for (const row of targets) {
      await client.query(`INSERT INTO ${schema}.quiz_attempts VALUES ($1)`, [row.quiz_attempt_id]);
      await client.query(`UPDATE ${schema}.certificates SET quiz_attempt_id=$1 WHERE id=$2`, [row.quiz_attempt_id, row.id]);
    }
    await client.query(attemptDown);
    await assert.rejects(client.query(`DELETE FROM ${schema}.quiz_attempts WHERE id=$1`, [targets[0].quiz_attempt_id]), { code: '23503' });
    await assert.rejects(client.query(`UPDATE ${schema}.certificates SET quiz_attempt_id=NULL WHERE id=$1`, [targets[0].id]), { code: '23502' });
    await client.query(attemptUp);
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
