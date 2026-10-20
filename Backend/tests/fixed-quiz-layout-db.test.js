import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';
import { upgradeQuestionCategories } from './helpers/question-categories-schema.js';
import { upgradeFixedQuizLayout } from './helpers/fixed-quiz-schema.js';

test('fixed layout migration converts percentages, preserves snapshots and derives counts across SQL edits and concurrency', {skip: !process.env.TEST_DATABASE_URL}, async t => {
  const schema=`fixed_layout_${randomUUID().replaceAll('-','')}`;
  const db=new pg.Client({connectionString:process.env.TEST_DATABASE_URL,statement_timeout:10000});
  await db.connect();
  const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,max:3,statement_timeout:10000,options:`-c search_path=${schema},public`});
  t.after(async()=>{await pool.end();try{await db.query(`DROP SCHEMA ${schema} CASCADE`);}finally{await db.end();}});
  await db.query(`CREATE SCHEMA ${schema}`);
  await db.query(`SET search_path TO ${schema},public`);
  await db.query('CREATE TABLE users(id uuid PRIMARY KEY)');
  for(const file of ['1791590400001_add-questions.sql','1791590400003_add-question-groups.sql','1791590400004_add-quizzes.sql',
    '1792281600000_add-quiz-questions.sql','1792281600001_add-quiz-sources.sql',
    '1792195200001_add-quiz-attempts.sql','1792195200002_add-quiz-attempt-questions-and-answers.sql']) {
    const sql=(await readFile(new URL(`../src/database/migrations/${file}`,import.meta.url),'utf8')).replaceAll('public.',`${schema}.`);
    await db.query(sql.split('-- Down Migration')[0]);
  }
  await upgradeQuestionCategories(db,{schema});
  const owner=randomUUID(),quiz=randomUUID(),a=randomUUID(),b=randomUUID(),fixed=randomUUID(),attempt=randomUUID();
  await db.query('INSERT INTO users VALUES($1)',[owner]);
  await db.query("INSERT INTO quizzes(id,user_id,title,question_count) VALUES($1,$2,'Legacy',3)",[quiz,owner]);
  await db.query("INSERT INTO question_categories(id,user_id,name) VALUES($1,$3,'A'),($2,$3,'B')",[a,b,owner]);
  await db.query("INSERT INTO questions(id,user_id,type,content) VALUES($1,$2,'single_choice','Fixed')",[fixed,owner]);
  await db.query('INSERT INTO quiz_questions(quiz_id,question_id,max_points) VALUES($1,$2,2.5)',[quiz,fixed]);
  await db.query('INSERT INTO quiz_sources(quiz_id,category_id,position,question_percentage) VALUES($1,$2,0,50),($1,$3,1,50)',[quiz,a,b]);
  await db.query("INSERT INTO quiz_attempts(id,quiz_id,user_id,attempt_no,settings_snapshot) VALUES($1,$2,$3,1,'{\"question_count\":3}')",[attempt,quiz,owner]);
  await db.query("INSERT INTO quiz_attempt_questions(attempt_id,question_no,question_id,question_snapshot,max_points) VALUES($1,1,$2,'{\"content\":\"historical\"}',2.5)",[attempt,fixed]);
  const tiny=randomUUID();
  await db.query("INSERT INTO quizzes(id,user_id,title,question_count) VALUES($1,$2,'Small legacy quiz',1)",[tiny,owner]);
  await db.query('INSERT INTO quiz_sources(quiz_id,category_id,position,question_percentage) VALUES($1,$2,0,99),($1,$3,1,1)',[tiny,a,b]);
  const migration=await upgradeFixedQuizLayout(db,{schema});
  assert.deepEqual((await db.query('SELECT category_id,question_count FROM quiz_sources WHERE quiz_id=$1',[tiny])).rows,[{category_id:a,question_count:1}]);
  const total=async()=>Number((await db.query('SELECT question_count FROM quizzes WHERE id=$1',[quiz])).rows[0].question_count);
  assert.equal(await total(),4);
  const sources=(await db.query('SELECT * FROM quiz_sources WHERE quiz_id=$1 ORDER BY position',[quiz])).rows;
  assert.deepEqual(sources.map(s=>s.question_count),[2,1]);
  assert.ok(sources.every(s=>s.max_points==='1.00'&&!Object.hasOwn(s,'question_percentage')));
  assert.equal((await db.query('SELECT settings_snapshot FROM quiz_attempts WHERE id=$1',[attempt])).rows[0].settings_snapshot.question_count,3);
  assert.equal((await db.query('SELECT question_snapshot FROM quiz_attempt_questions WHERE attempt_id=$1',[attempt])).rows[0].question_snapshot.content,'historical');
  await db.query('UPDATE quizzes SET question_count=99 WHERE id=$1',[quiz]);assert.equal(await total(),4);
  await db.query('BEGIN');await db.query('UPDATE quiz_sources SET question_count=5 WHERE id=$1',[sources[0].id]);assert.equal(await total(),7);
  await db.query('ROLLBACK');assert.equal(await total(),4);
  const newQuestions=[randomUUID(),randomUUID()];
  await db.query("INSERT INTO questions(id,user_id,type,content) VALUES($1,$3,'single_choice','A'),($2,$3,'single_choice','B')",[...newQuestions,owner]);
  // Different writes to both child tables cannot lose a derived-count update.
  await Promise.all([
    pool.query('INSERT INTO quiz_questions(quiz_id,question_id) VALUES($1,$2)',[quiz,newQuestions[0]]),
    pool.query('INSERT INTO quiz_questions(quiz_id,question_id) VALUES($1,$2)',[quiz,newQuestions[1]]),
    pool.query('UPDATE quiz_sources SET question_count=question_count+1 WHERE id=$1',[sources[0].id]),
  ]);
  assert.equal(await total(),7);
  await db.query('DELETE FROM questions WHERE id=$1',[newQuestions[0]]);assert.equal(await total(),6);
  await db.query('DELETE FROM question_categories WHERE id=$1',[a]);assert.equal(await total(),3);
  await db.query('DELETE FROM quiz_sources WHERE quiz_id=$1',[quiz]);assert.equal(await total(),2);
  await db.query('DELETE FROM quiz_questions WHERE quiz_id=$1',[quiz]);assert.equal(await total(),0);
  assert.equal((await db.query('SELECT question_snapshot FROM quiz_attempt_questions WHERE attempt_id=$1',[attempt])).rows[0].question_snapshot.content,'historical');
  await db.query(migration.split('-- Down Migration')[1]);
  await db.query(migration.split('-- Down Migration')[0]);assert.equal(await total(),0);
});
