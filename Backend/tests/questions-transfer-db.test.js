import { upgradeQuestionCategories } from './helpers/question-categories-schema.js';
import { installQuizPermissions } from './helpers/quiz-permissions-schema.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { mock, test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { importMoodleXml } from '../src/modules/quizzes-engine/questions/helpers/moodleXml.js';
const fixture = await readFile(new URL('./fixtures/moodle-questions.xml', import.meta.url), 'utf8');

test('Moodle import/export HTTP authorization, transactionality and database round trip', {skip:!process.env.TEST_DATABASE_URL}, async t => {
  const client = new pg.Client({connectionString:process.env.TEST_DATABASE_URL,statement_timeout:10000});
  await client.connect();
  t.after(() => client.end());
  await client.query("CREATE TEMP TABLE users(id uuid PRIMARY KEY,status text DEFAULT 'active',authz_version int DEFAULT 1)");
  const owner=randomUUID(), other=randomUUID(), viewer=randomUUID();
  await client.query('INSERT INTO pg_temp.users(id) VALUES($1),($2),($3)',[owner,other,viewer]);
  for (const file of ['1791590400001_add-questions.sql','1791590400002_add-question-timestamps.sql']) {
    const sql=await readFile(new URL(`../src/database/migrations/${file}`,import.meta.url),'utf8');
    await client.query(sql.split('-- Down Migration')[0].replaceAll('public.','pg_temp.'));
  }
  await installQuizPermissions(client);
  await upgradeQuestionCategories(client);
  await client.query("UPDATE pg_temp.user_roles SET role_id=(SELECT id FROM pg_temp.roles WHERE name='Viewer') WHERE user_id=$1",[viewer]);
  let insertCount=0, failAt=0;
  const query=async (sql,values) => {
    if (/INSERT INTO public.questions /.test(sql) && ++insertCount === failAt) throw new Error('Injected import write failure');
    return client.query(sql.replaceAll('public.','pg_temp.'),values);
  };
  mock.module(new URL('../src/database/index.js',import.meta.url).href,{namedExports:{writePool:{query,async connect(){return {query,release(){}};}}}});
  const previous=process.env.JWT_SECRET;
  process.env.JWT_SECRET='question-transfer-test';
  t.after(() => { if(previous===undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET=previous; });
  const token=id=>jwt.sign({sub:id,authzVersion:1},process.env.JWT_SECRET);
  const {default:router}=await import('../src/modules/quizzes-engine/quizzes-engine.routes.js');
  const app=express(); app.use(express.json()); app.use('/api/quizzes',router);
  const server=app.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}/api/quizzes/questions`;
  const call=(method,path,body,as=owner,headers={})=>fetch(base+path,{method,headers:{...(as?{Authorization:`Bearer ${token(as)}`} : {}),...headers},body});
  const upload=(xml=fixture,suffix='',as=owner)=>call('POST','/import'+suffix,xml,as,{'Content-Type':'application/xml'});
  let ids, xml;
  await t.test('import/export require authentication and existing question permissions',async()=>{
    for(const as of [null,viewer]) {
      assert.equal((await upload(fixture,'',as)).status,as?403:401);
      assert.equal((await call('GET','/export',undefined,as)).status,as?403:401);
    }
  });
  await t.test('raw XML imports categories and full questions, export is an authenticated XML attachment',async()=>{
    const imported=await upload(); assert.equal(imported.status,201);
    const body=await imported.json(); assert.equal(body.imported_count,3);
    ids=body.questions.map(q=>q.id);
    assert.deepEqual(body.questions.map(q=>q.max_points),[2.75,4,3]);
    assert.equal(body.questions[0].category.name,'Programiranje/Osnove');
    const response=await call('GET','/export'); assert.equal(response.status,200);
    assert.match(response.headers.get('content-type'),/application\/xml/);
    assert.match(response.headers.get('content-disposition'),/attachment; filename="questions-moodle.xml"/);
    assert.equal(response.headers.get('cache-control'),'no-store');
    xml=await response.text();
    const parsed=importMoodleXml(xml).questions;
    assert.equal(parsed.length,3);
    assert.deepEqual(parsed.map(q=>q.max_points).sort(),[2.75,3,4]);
    assert.ok(parsed.find(q=>q.type==='matching').matching_items.length===3);
    const filtered=await call('GET',`/export?question_ids=${ids[0]}`);
    assert.equal(importMoodleXml(await filtered.text()).questions.length,1);
  });
  await t.test('multipart file round trip creates new questions owned by the importing user',async()=>{
    const form=new FormData(); form.append('file',new Blob([xml],{type:'application/xml'}),'questions.xml');
    const response=await call('POST','/import',form,other);
    const result=await response.json(); assert.equal(response.status,201,JSON.stringify(result));
    assert.equal(result.imported_count,3);
    assert.ok(result.questions.every(q=>!ids.includes(q.id)));
    assert.equal((await call('GET',`/export?question_ids=${ids[0]}`,undefined,other)).status,404);
    const mine=await call('GET','/export',undefined,other);
    assert.equal(importMoodleXml(await mine.text()).questions.length,3);
  });
  await t.test('category override is owner scoped and XML categories can be reused without creating duplicates',async()=>{
    const cat=(await client.query('SELECT id FROM pg_temp.question_categories WHERE user_id=$1',[owner])).rows[0].id;
    const override=await upload(fixture,`?category_id=${cat}`);
    assert.equal(override.status,201);
    assert.ok((await override.json()).questions.every(q=>q.category.id===cat));
    assert.equal((await upload(fixture,`?category_id=${cat}`,other)).status,404);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_temp.question_categories WHERE user_id=$1',[owner])).rows[0].n,1);
    assert.equal((await call('GET',`/export?category_id=${cat}&type=single_choice`)).status,200);
  });
  await t.test('category creation requires its own permission and the import is fully rolled back',async()=>{
    const {importQuestionsInternal:importQuestions}=await import('../src/modules/quizzes-engine/questions/handlers/importQuestions.js');
    const before=Number((await client.query('SELECT count(*) FROM pg_temp.questions')).rows[0].count);
    await assert.rejects(importQuestions(fixture.replaceAll('Programiranje/Osnove','New forbidden category'),{},owner),{status:403});
    assert.equal(Number((await client.query('SELECT count(*) FROM pg_temp.questions')).rows[0].count),before);
    insertCount=0; failAt=2;
    await assert.rejects(importQuestions(fixture.replaceAll('Programiranje/Osnove','Rolled back category'),{},owner,{canCreateCategories:true}),/Injected import write failure/);
    failAt=0;
    assert.equal(Number((await client.query('SELECT count(*) FROM pg_temp.questions')).rows[0].count),before);
    assert.equal((await client.query("SELECT id FROM pg_temp.question_categories WHERE name='Rolled back category'")).rowCount,0);
  });
  await t.test('bad files, encodings, media types and unsupported questions fail without partial writes',async()=>{
    const before=Number((await client.query('SELECT count(*) FROM pg_temp.questions')).rows[0].count);
    assert.equal((await upload(fixture.replace('</quiz>','<question type="essay"/></quiz>'))).status,422);
    assert.equal((await upload('<quiz>')).status,422);
    assert.equal((await upload(Buffer.from([0xff,0xfe,0x01]))).status,400);
    assert.equal((await call('POST','/import','{}',owner,{'Content-Type':'application/json'})).status,415);
    const empty=new FormData();
    assert.equal((await call('POST','/import',empty)).status,400);
    const tooLarge=new FormData(); tooLarge.append('file',new Blob(['a'.repeat(5*1024*1024+1)]),'large.xml');
    assert.equal((await call('POST','/import',tooLarge)).status,413);
    assert.equal((await call('GET','/export?question_ids=bad')).status,400);
    assert.equal(Number((await client.query('SELECT count(*) FROM pg_temp.questions')).rows[0].count),before);
  });
});
