import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { mock, test } from 'node:test';
import pg from 'pg';

const deferred=()=>{let resolve; const promise=new Promise(r=>{resolve=r;}); return {promise,resolve};};

test('expiration uses saved grades safely in isolated PostgreSQL', {skip:!process.env.TEST_DATABASE_URL}, async t => {
  const schema=`quiz_expiration_${randomUUID().replaceAll('-','')}`;
  const admin=new pg.Client({connectionString:process.env.TEST_DATABASE_URL,statement_timeout:10000});
  await admin.connect();
  const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,max:5,statement_timeout:10000,options:`-c search_path=${schema},public`});
  t.after(async()=>{await pool.end();try{await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);}finally{await admin.end();}});
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.query(`SET search_path TO ${schema},public`);
  await admin.query('CREATE TABLE users(id uuid PRIMARY KEY)');
  for(const file of ['1791590400001_add-questions.sql','1791590400004_add-quizzes.sql','1792195200001_add-quiz-attempts.sql','1792195200002_add-quiz-attempt-questions-and-answers.sql','1792540800002_index-expired-quiz-attempts.sql']) {
    const sql=(await readFile(new URL(`../src/database/migrations/${file}`,import.meta.url),'utf8')).replaceAll('public.',`${schema}.`);
    await admin.query(sql.split('-- Down Migration')[0]);
  }
  const user=randomUUID(); await admin.query('INSERT INTO users VALUES($1)',[user]);
  const wrap=client=>({query:(sql,args)=>client.query(sql.replaceAll('public.',`${schema}.`),args)});
  const wrappedPool={async connect(){const client=await pool.connect();return {...wrap(client),release:()=>client.release()};}};
  mock.module(new URL('../src/database/index.js',import.meta.url).href,{namedExports:{writePool:wrappedPool}});
  const {expireAttempts}=await import('../src/modules/quizzes-engine/quiz-attempts/workers/expireAttempts.js');
  const {finalizeExpiredAttempt}=await import('../src/modules/quizzes-engine/quiz-attempts/services/finalizeAttempt.js');
  const {getAttemptResults}=await import('../src/modules/quizzes-engine/quiz-attempts/services/attemptResults.js');
  const messages=[]; const logger={error:message=>messages.push(message),log(){}};
  const run=options=>expireAttempts({logger,...options});
  const row=async id=>(await admin.query('SELECT * FROM quiz_attempts WHERE id=$1',[id])).rows[0];
  async function fixture({expires='2020-01-01T00:00:00.000001Z',status='in_progress',settings={},answered=true}={}) {
    const quiz=randomUUID(),id=randomUUID();
    await admin.query("INSERT INTO quizzes(id,user_id,title,question_count) VALUES($1,$2,'Quiz',3)",[quiz,user]);
    await admin.query(`INSERT INTO quiz_attempts(id,quiz_id,user_id,attempt_no,status,expires_at,settings_snapshot)
      VALUES($1,$2,$3,1,$4,$5,$6)`,[id,quiz,user,status,expires,{passing_score_percentage:30,min_answered_percentage:100,min_correct_percentage:100,...settings}]);
    for(const [i,points] of [2,3,5].entries()) await admin.query("INSERT INTO quiz_attempt_questions(attempt_id,question_no,question_snapshot,max_points) VALUES($1,$2,'{}',$3)",[id,i+1,points]);
    if(answered) await admin.query(`INSERT INTO quiz_attempt_answers(attempt_id,question_no,answer,checked_at,is_correct,awarded_points)
      VALUES($1,1,'{}',now(),true,2),($1,2,'{}',now(),false,1.5)`,[id]);
    return id;
  }
  const scenario=(name,fn)=>t.test(name,async()=>{await admin.query('TRUNCATE quiz_attempts CASCADE');messages.length=0;await fn();});

  await scenario('computes the same scores as submit but ignores submission thresholds, preserves answers and is idempotent',async()=>{
    const id=await fixture();
    const before=(await admin.query('SELECT * FROM quiz_attempt_answers WHERE attempt_id=$1 ORDER BY question_no',[id])).rows;
    await assert.rejects(getAttemptResults(wrap(admin),await row(id),{requireSubmissionRequirements:true}),error=>error.body.code==='MIN_ANSWERED_PERCENTAGE_NOT_MET');
    const summary=await getAttemptResults(wrap(admin),await row(id));
    const result=await run(); assert.equal(result.finalized,1);
    const saved=await row(id);
    assert.equal(saved.status,'timed_out'); assert.equal(saved.earned_points,summary.earned_points);
    assert.equal(saved.max_points,'10.00'); assert.equal(saved.score_percentage,'35.00'); assert.equal(saved.passed,true);
    assert.equal(saved.finished_at.getTime(),saved.expires_at.getTime());
    assert.deepEqual((await admin.query('SELECT * FROM quiz_attempt_answers WHERE attempt_id=$1 ORDER BY question_no',[id])).rows,before);
    assert.equal((await run()).scanned,0);
    const connection=await pool.connect();
    try {await connection.query('BEGIN');assert.equal(await finalizeExpiredAttempt(wrap(connection),id),null);await connection.query('COMMIT');}finally{connection.release();}
    assert.deepEqual(await row(id),saved);
  });

  await scenario('zero answered scores zero; open-ended, future and terminal attempts are untouched',async()=>{
    const zero=await fixture({answered:false});
    const ids=[await fixture({expires:null}),await fixture({expires:'2099-01-01T00:00:00Z'}),await fixture({status:'submitted'}),await fixture({status:'cancelled'}),await fixture({status:'timed_out'})];
    const before=await Promise.all(ids.map(row));
    assert.equal((await run()).finalized,1);
    assert.equal((await row(zero)).earned_points,'0.00'); assert.equal((await row(zero)).passed,false);
    assert.deepEqual(await Promise.all(ids.map(row)),before);
  });

  await scenario('invalid snapshot does not block healthy rows and rotating batches preserve microsecond cursors',async()=>{
    const bad=await fixture({settings:{passing_score_percentage:'bad'},expires:'2020-01-01T00:00:00.000001Z'});
    const good=await fixture({expires:'2020-01-01T00:00:00.000002Z'});
    const first=await run({batchSize:1}); assert.equal(first.failed,1); assert.equal(first.finalized,0); assert.ok(first.nextCursor.expiresAt.includes('000001'));
    const second=await run({batchSize:1,cursor:first.nextCursor}); assert.equal(second.finalized,1);
    assert.equal((await row(bad)).status,'in_progress'); assert.equal((await row(good)).status,'timed_out');
    assert.match(messages[0],/INVALID_ATTEMPT_SETTINGS/);
    assert.equal((await run({batchSize:1,cursor:second.nextCursor})).nextCursor,null);
    await admin.query("UPDATE quiz_attempts SET settings_snapshot=jsonb_set(settings_snapshot,'{passing_score_percentage}','30') WHERE id=$1",[bad]);
    assert.equal((await run()).finalized,1);
  });

  await scenario('savepoints isolate corrupt grades while healthy attempts in the same transaction complete',async()=>{
    const bad=await fixture(),good=await fixture();
    await admin.query('UPDATE quiz_attempt_answers SET awarded_points=20 WHERE attempt_id=$1 AND question_no=1',[bad]);
    const result=await run(); assert.equal(result.failed,1); assert.equal(result.finalized,1);
    assert.equal((await row(bad)).status,'in_progress'); assert.equal((await row(good)).status,'timed_out');
    assert.match(messages[0],/INVALID_ATTEMPT_RESULTS/);
  });

  await scenario('two worker instances claim disjoint rows without double finalization',async()=>{
    const ids=await Promise.all([fixture(),fixture(),fixture(),fixture()]);
    const claimed=deferred(),release=deferred(); let paused=false;
    const pausingPool={async connect(){const c=await wrappedPool.connect();return {release:()=>c.release(),async query(sql,args){
      const result=await c.query(sql,args);
      if(!paused && sql.includes('SKIP LOCKED')) {paused=true;claimed.resolve();await release.promise;}
      return result;
    }};}};
    const first=run({batchSize:2,pool:pausingPool}); await claimed.promise;
    let second;
    try {second=await run({batchSize:2});}finally{release.resolve();}
    const a=await first; assert.equal(a.finalized+second.finalized,4);
    assert.ok((await Promise.all(ids.map(row))).every(a=>a.status==='timed_out'));
  });

  await scenario('locked answer writer is skipped; finalization later sees its committed grade',async()=>{
    const id=await fixture(),other=await fixture(); const c=await pool.connect();
    try {
      await c.query('BEGIN'); await c.query('SELECT id FROM quiz_attempts WHERE id=$1 FOR UPDATE',[id]);
      await c.query('UPDATE quiz_attempt_answers SET awarded_points=3,is_correct=true WHERE attempt_id=$1 AND question_no=2',[id]);
      assert.equal((await run()).finalized,1); assert.equal((await row(other)).status,'timed_out');
      await c.query('COMMIT');
      assert.equal((await run()).finalized,1); assert.equal((await row(id)).earned_points,'5.00');
    }finally{await c.query('ROLLBACK');c.release();}
  });

  await scenario('a concurrently submitted attempt cannot be overwritten as timed_out',async()=>{
    const id=await fixture();const c=await pool.connect();
    try {
      await c.query('BEGIN'); await c.query("UPDATE quiz_attempts SET status='submitted',earned_points=3.5,max_points=10,score_percentage=35,passed=true,finished_at=now() WHERE id=$1",[id]);
      assert.equal((await run()).finalized,0);
      await c.query('COMMIT'); const saved=await row(id);
      assert.equal((await run()).scanned,0);assert.deepEqual(await row(id),saved);
    }finally{await c.query('ROLLBACK');c.release();}
  });

  await scenario('unexpected SQL failure and cancellation roll back the batch and release locks',async()=>{
    for(const abort of [false,true]) {
      const id=await fixture();const controller=new AbortController();let released=false;
      const brokenPool={async connect(){const c=await wrappedPool.connect();return {release(){released=true;c.release();},async query(sql,args){
        const result=await c.query(sql,args);
        if(sql.includes("SET status='timed_out'")) {if(abort) controller.abort();else throw new Error('Injected update failure');}
        return result;
      }};}};
      await assert.rejects(run({pool:brokenPool,signal:controller.signal}),abort?{name:'AbortError'}:/Injected update failure/);
      assert.equal(released,true); assert.equal((await row(id)).status,'in_progress');
      assert.equal((await run()).finalized,1);
    }
  });

  await scenario('expiration index migration supports rollback and reapply',async()=>{
    const sql=(await readFile(new URL('../src/database/migrations/1792540800002_index-expired-quiz-attempts.sql',import.meta.url),'utf8')).replaceAll('public.',`${schema}.`);
    await admin.query(sql.split('-- Down Migration')[1]);
    assert.equal((await admin.query('SELECT to_regclass($1) AS name',[`${schema}.quiz_attempts_expiration_idx`])).rows[0].name,null);
    await admin.query(sql.split('-- Down Migration')[0]);
    assert.ok((await admin.query('SELECT to_regclass($1) AS name',[`${schema}.quiz_attempts_expiration_idx`])).rows[0].name);
  });
});
