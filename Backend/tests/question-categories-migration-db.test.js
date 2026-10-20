import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';
import { installQuizPermissions } from './helpers/quiz-permissions-schema.js';
import { upgradeQuestionCategories } from './helpers/question-categories-schema.js';

test('migration chooses first category by name/ID, preserves grants and snapshots, and enforces one optional same-owner category', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await db.connect(); t.after(() => db.end());
  await db.query('SET search_path TO pg_temp,public');
  await db.query("CREATE TEMP TABLE users(id uuid PRIMARY KEY)");
  for (const file of ['1791590400001_add-questions.sql', '1791590400003_add-question-groups.sql',
    '1791590400004_add-quizzes.sql', '1792195200001_add-quiz-attempts.sql', '1792195200002_add-quiz-attempt-questions-and-answers.sql',
    '1792281600001_add-quiz-sources.sql']) {
    const sql = (await readFile(new URL(`../src/database/migrations/${file}`, import.meta.url), 'utf8')).replaceAll('public.', 'pg_temp.');
    await db.query(sql.split('-- Down Migration')[0]);
  }
  const user = randomUUID(), other = randomUUID(), question = randomUUID(), quiz = randomUUID(), attempt = randomUUID();
  const a = randomUUID(), z = randomUUID(), foreign = randomUUID();
  await db.query('INSERT INTO users VALUES($1),($2)', [user, other]);
  await installQuizPermissions(db);
  const grants = (await db.query('SELECT * FROM role_permissions ORDER BY role_id,permission_id')).rows;
  const permission = (await db.query("SELECT id FROM permissions WHERE key='question_groups.update_own'")).rows[0];
  await db.query("INSERT INTO question_groups(id,user_id,name) VALUES($1,$3,'Alpha'),($2,$3,'Zulu'),($4,$5,'Foreign')", [a,z,user,foreign,other]);
  await db.query("INSERT INTO questions(id,user_id,type,content) VALUES($1,$2,'single_choice','Original')", [question,user]);
  await db.query('INSERT INTO question_group_items VALUES($1,$3),($2,$3)', [z,a,question]);
  await db.query("INSERT INTO quizzes(id,user_id,title,question_count) VALUES($1,$2,'Quiz',1)", [quiz,user]);
  await db.query('INSERT INTO quiz_sources(quiz_id,group_id,question_count) VALUES($1,$2,1)', [quiz,a]);
  const snapshot = { source_group_id: z, explanation: 'Historical snapshot', options: [] };
  await db.query("INSERT INTO quiz_attempts(id,quiz_id,user_id,attempt_no,settings_snapshot) VALUES($1,$2,$3,1,'{}')", [attempt,quiz,user]);
  await db.query('INSERT INTO quiz_attempt_questions(attempt_id,question_no,question_id,question_snapshot) VALUES($1,1,$2,$3)', [attempt,question,snapshot]);
  await upgradeQuestionCategories(db);
  assert.equal((await db.query('SELECT category_id FROM questions WHERE id=$1', [question])).rows[0].category_id,a);
  assert.equal((await db.query("SELECT to_regclass('pg_temp.question_group_items') AS name")).rows[0].name,null);
  assert.equal((await db.query('SELECT category_id FROM quiz_sources WHERE quiz_id=$1', [quiz])).rows[0].category_id,a);
  assert.deepEqual((await db.query('SELECT question_snapshot FROM quiz_attempt_questions WHERE attempt_id=$1', [attempt])).rows[0].question_snapshot,snapshot);
  assert.deepEqual((await db.query('SELECT * FROM role_permissions ORDER BY role_id,permission_id')).rows,grants);
  assert.deepEqual((await db.query("SELECT id FROM permissions WHERE key='question_categories.update_own'")).rows[0],permission);
  await assert.rejects(db.query('UPDATE questions SET category_id=$1 WHERE id=$2',[foreign,question]),{code:'23514'});
  await assert.rejects(db.query('UPDATE questions SET user_id=$1 WHERE id=$2',[other,question]),{code:'23514'});
  await assert.rejects(db.query('UPDATE question_categories SET user_id=$1 WHERE id=$2',[other,a]),{code:'23514'});
  await db.query('DELETE FROM question_categories WHERE id=$1',[a]);
  assert.equal((await db.query('SELECT category_id FROM questions WHERE id=$1',[question])).rows[0].category_id,null);
  assert.equal((await db.query('SELECT * FROM quiz_sources WHERE quiz_id=$1',[quiz])).rowCount,0);
  await db.query('INSERT INTO quiz_sources(quiz_id,category_id,question_count) VALUES($1,NULL,1)',[quiz]);
  await assert.rejects(db.query('INSERT INTO quiz_sources(quiz_id,category_id,question_count) VALUES($1,NULL,1)',[quiz]),{code:'23505'});
});
