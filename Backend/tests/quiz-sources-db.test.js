import { upgradeFixedQuizLayout } from './helpers/fixed-quiz-schema.js';
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

test('source migration, HTTP CRUD and concurrent allocations in an isolated PostgreSQL schema', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const schema = `quiz_sources_test_${randomUUID().replaceAll('-', '')}`;
  const connectionString = process.env.TEST_DATABASE_URL;
  const admin = new pg.Client({ connectionString, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  await admin.connect();
  const pool = new pg.Pool({ connectionString, max: 4, connectionTimeoutMillis: 5000, statement_timeout: 10000, options: `-c search_path=${schema},public` });
  t.after(async () => {
    await pool.end();
    try { await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); } finally { await admin.end(); }
  });
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.query(`SET search_path TO ${schema},public`);
  await admin.query("CREATE TABLE users (id uuid PRIMARY KEY, status text DEFAULT 'active', authz_version integer DEFAULT 1)");
  let migration;
  for (const file of ['1791590400001_add-questions.sql', '1791590400003_add-question-groups.sql',
    '1791590400004_add-quizzes.sql', '1792195200000_add-quiz-feedback-and-scoring-settings.sql', '1792627200001_add-quiz-questions-per-page.sql', '1792281600001_add-quiz-sources.sql']) {
    const sql = (await readFile(new URL(`../src/database/migrations/${file}`, import.meta.url), 'utf8')).replaceAll('public.', `${schema}.`);
    await admin.query(sql.split('-- Down Migration')[0]);
    migration = sql;
  }
  const owner = randomUUID(), other = randomUUID();
  await admin.query('INSERT INTO users(id) VALUES ($1),($2)', [owner, other]);
  await installQuizPermissions(admin, { schema });
  migration = await upgradeQuestionCategories(admin, { schema });
  migration = await upgradeFixedQuizLayout(admin, { schema });
  let releases = 0;
  const queryOn = database => (sql, params) => database.query(sql.replaceAll('public.', `${schema}.`), params);
  mock.module(new URL('../src/database/index.js', import.meta.url).href, { namedExports: { writePool: {
    query: queryOn(pool), async connect() {
      const client = await pool.connect();
      return { query: queryOn(client), release() { releases++; client.release(); } };
    },
  } } });
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'quiz-sources-test-secret';
  t.after(() => { if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret; });
  const token = jwt.sign({ sub: owner, authzVersion: 1 }, process.env.JWT_SECRET);
  const otherToken = jwt.sign({ sub: other, authzVersion: 1 }, process.env.JWT_SECRET);
  const { default: router } = await import('../src/modules/quizzes-engine/quizzes-engine.routes.js');
  const app = express();
  app.use(express.json());
  app.use('/api/quizzes', router);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  async function http(method, path, body, bearer = token) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/quizzes${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, ...await response.json() };
  }
  const request = (method, quizId, suffix = '', body, bearer = token) => http(method, `/${quizId}/sources${suffix}`, body, bearer);
  const put = (id, sources) => request('PUT', id, '', { sources });
  async function quiz(userId = owner, count = 10) {
    const id = randomUUID();
    await admin.query("INSERT INTO quizzes(id,user_id,title,question_count) VALUES ($1,$2,'Quiz',$3)", [id, userId, count]);
    return id;
  }
  async function category(userId = owner) {
    const id = randomUUID();
    await admin.query('INSERT INTO question_categories(id,user_id,name) VALUES ($1,$2,$3)', [id, userId, id]);
    return id;
  }
  const count = (category_id, question_count, position = 0) => ({ category_id, question_count, position });
  const stored = async id => (await admin.query('SELECT * FROM quiz_sources WHERE quiz_id=$1 ORDER BY position,category_id', [id])).rows;

  await t.test('all six routes require access tokens and scope access to the quiz owner', async () => {
    const id = await quiz(), gid = await category();
    await put(id, [count(gid, 100)]);
    for (const [method, suffix, body] of [['GET', '', undefined], ['GET', `/${gid}`, undefined],
      ['POST', '', count(gid, 100)], ['PUT', '', { sources: [] }], ['PATCH', `/${gid}`, { position: 1 }], ['DELETE', `/${gid}`, undefined]]) {
      for (const bearer of [null, jwt.sign({ sub: owner, purpose: 'two_factor' }, process.env.JWT_SECRET)]) {
        assert.equal((await request(method, id, suffix, body, bearer)).status, 401);
      }
      assert.equal((await request(method, id, suffix, body, otherToken)).status, 404);
    }
    assert.equal((await request('POST', id, '', count(await category(other), 100))).status, 404);
    assert.equal((await put(id, [count(randomUUID(), 100)])).status, 404);
    assert.equal((await request('GET', randomUUID())).status, 404);
    assert.equal((await request('GET', id, `/${randomUUID()}`)).status, 404);
    assert.equal((await put(await quiz(other), [])).status, 404);
  });

  await t.test('source CRUD keeps immutable category IDs, default weights and derives the quiz total', async () => {
    const id=await quiz(), gid=await category();
    const created=await request('POST',id,'',{category_id:gid,question_count:3});
    assert.equal(created.status,201);
    assert.equal(created.source.max_points,1);
    assert.equal(created.source.question_count,3);
    assert.equal(created.source.category.id,gid);
    const sid=created.source.id;
    assert.deepEqual((await request('GET',id,`/${sid}`)).source,created.source);
    assert.equal((await request('POST',id,'',count(gid,2))).status,409);
    const changed=await request('PATCH',id,`/${sid}`,{question_count:5,max_points:2.25,position:4});
    assert.equal(changed.status,200);
    assert.equal(changed.source.max_points,2.25);
    assert.equal((await http('GET',`/${id}`)).quiz.question_count,5);
    assert.equal((await request('PATCH',id,`/${sid}`,{question_percentage:100})).status,400);
    assert.equal((await request('DELETE',id,`/${sid}`)).status,200);
    assert.equal((await http('GET',`/${id}`)).quiz.question_count,0);
    assert.equal((await request('DELETE',id,`/${sid}`)).status,404);
    assert.equal((await admin.query('SELECT id FROM question_categories WHERE id=$1',[gid])).rowCount,1);
  });

  await t.test('replacement accepts independent counts and rolls back foreign, duplicate or invalid sources', async () => {
    const id=await quiz(), a=await category(), b=await category();
    assert.equal((await put(id,[count(a,3),count(b,2)])).status,200);
    const before=await stored(id);
    for(const entries of [[count(a,0)],[count(a,1.5)],[count(a,1),count(a,2)],[{category_id:a,question_percentage:100}]]) {
      assert.equal((await put(id,entries)).status,400);
      assert.deepEqual(await stored(id),before);
    }
    assert.equal((await put(id,[count(a,2),count(await category(other),1)])).status,404);
    assert.deepEqual(await stored(id),before);
    assert.equal((await request('DELETE',id,`/${before[0].id}`)).status,200);
    assert.equal((await put(id,[])).status,200);
    assert.deepEqual(await stored(id),[]);
  });

  await t.test('list supports all sorting fields, stable pagination, empty pages and basic category details', async () => {
    const id = await quiz(), a = await category(), b = await category(), c = await category();
    await put(id, [count(a, 20), count(b, 30), count(c, 50, 1)]);
    const result = await request('GET', id);
    assert.equal(result.pagination.total, 3);
    for (const sortBy of ['position', 'category_id', 'max_points', 'question_count']) {
      for (const sortOrder of ['asc', 'desc']) {
        const expected = [...result.sources].sort((a, b) => {
          const diff = sortBy === 'category_id' ? a.category_id.localeCompare(b.category_id) : (a[sortBy] ?? 0) - (b[sortBy] ?? 0);
          return (sortOrder === 'asc' ? diff : -diff) || a.id.localeCompare(b.id);
        });
        const page = await request('GET', id, `?sortBy=${sortBy}&sortOrder=${sortOrder}&page=2&limit=1`);
        assert.equal(page.sources[0].category_id, expected[1].category_id);
        assert.deepEqual(page.pagination, { page: 2, limit: 1, total: 3, totalPages: 3, hasNextPage: true, hasPreviousPage: true });
      }
    }
    const emptyPage = await request('GET', id, '?page=10&limit=1');
    assert.deepEqual(emptyPage.sources, []);
    assert.equal(emptyPage.pagination.total, 3);
    assert.equal((await request('GET', await quiz())).pagination.total, 0);
    for (const suffix of ['?page=0', '?limit=101', '?sortBy=name', `?user_id=${other}`]) assert.equal((await request('GET', id, suffix)).status, 400);
  });

  await t.test('question_count is readonly and category cascades refresh it automatically', async () => {
    const id=await quiz(), a=await category(), b=await category();
    await put(id,[count(a,4),count(b,6)]);
    assert.equal((await http('PATCH',`/${id}`,{question_count:11})).status,400);
    assert.equal((await http('DELETE',`/question-categories/${a}`)).status,200);
    assert.equal((await http('GET',`/${id}`)).quiz.question_count,6);
    await admin.query('UPDATE quizzes SET question_count=999 WHERE id=$1',[id]);
    assert.equal((await http('GET',`/${id}`)).quiz.question_count,6);
    assert.equal((await http('DELETE',`/${id}`)).status,200);
    assert.deepEqual(await stored(id),[]);
  });

  await t.test('SQL enforces positive counts and weights, unique categories and ownership', async () => {
    const id=await quiz(), a=await category(), foreign=await category(other);
    const insert=(cat,n,points=1)=>admin.query('INSERT INTO quiz_sources(quiz_id,category_id,question_count,max_points) VALUES($1,$2,$3,$4)',[id,cat,n,points]);
    for(const args of [[a,0],[a,-1],[a,1,0],[a,1,'NaN'],[foreign,1]]) await assert.rejects(insert(...args),{code:'23514'});
    await assert.rejects(insert(a,null),{code:'23502'});
    await assert.rejects(insert(randomUUID(),1),{code:'23503'});
    await insert(a,2);
    await assert.rejects(insert(a,1),{code:'23505'});
    await assert.rejects(admin.query('UPDATE quizzes SET user_id=$1 WHERE id=$2',[other,id]),{code:'23514'});
    await assert.rejects(admin.query('UPDATE question_categories SET user_id=$1 WHERE id=$2',[other,a]),{code:'23514'});
    assert.equal((await http('GET',`/${id}`)).quiz.question_count,2);
  });

  await t.test('concurrent replacements serialize and retain a complete allocation', async () => {
    const id = await quiz(), a = await category(), b = await category(), c = await category();
    const results = await Promise.all([put(id, [count(a, 60), count(b, 40)]), put(id, [count(b, 3), count(c, 7)])]);
    assert.deepEqual(results.map(result => result.status), [200, 200]);
    const rows = await stored(id);
    assert.equal(rows.length, 2);
    assert.equal(rows.reduce((sum,row)=>sum+row.question_count,0),(await http('GET',`/${id}`)).quiz.question_count);
  });

  await t.test('uncategorized source uses positive counts and CRUD uses its source ID', async () => {
    const id = await quiz(), a = await category();
    const created = await put(id, [count(a, 80), count(null, 20)]);
    assert.equal(created.status, 200);
    const unassigned = created.sources.find(s => s.category_id === null);
    assert.ok(unassigned.id);
    assert.equal(unassigned.category, null);
    assert.deepEqual((await request('GET', id, `/${unassigned.id}`)).source, unassigned);
    assert.equal((await request('PATCH', id, `/${unassigned.id}`, { position: 4 })).status, 200);
    assert.equal((await request('POST', id, '', count(null, 20))).status, 409);
    assert.equal((await put(id, [count(null, 50), count(null, 50)])).status, 400);
    assert.equal((await put(id, [count(a, 8), count(null, 2)])).status, 200);
    assert.equal((await put(id, [count(null, 10)])).status, 200);
    const sole = (await stored(id))[0];
    assert.equal((await request('DELETE', id, `/${sole.id}`)).status, 200);
    assert.equal((await request('GET', id)).pagination.total, 0);
  });

  await t.test('moving a fixed question or source shifts the other layout items atomically', async () => {
    const id=await quiz(), a=await category(), q1=randomUUID(), q2=randomUUID();
    await admin.query("INSERT INTO questions(id,user_id,type,content) VALUES($1,$3,'single_choice','A'),($2,$3,'single_choice','B')",[q1,q2,owner]);
    await http('POST',`/${id}/questions`,{question_id:q1,position:0});
    await http('POST',`/${id}/questions`,{question_id:q2,position:2});
    const source=(await request('POST',id,'',{category_id:a,question_count:3,position:1})).source;
    assert.equal((await http('PATCH',`/${id}/questions/${q2}`,{position:0})).status,200);
    assert.equal((await request('GET',id,`/${source.id}`)).source.position,2);
    assert.equal((await request('PATCH',id,`/${source.id}`,{position:0})).status,200);
    const fixed=(await http('GET',`/${id}/questions`)).questions;
    assert.deepEqual(fixed.map(q=>[q.question_id,q.position]),[[q2,1],[q1,2]]);
    assert.equal((await http('GET',`/${id}`)).quiz.question_count,5);
  });

  await t.test('source CRUD preserves explicit null points, omission and positive overrides; migration rolls back', async () => {
    const id = await quiz(), cat = await category();
    const created = await request('POST', id, '', { category_id:cat, question_count:2, max_points:null });
    assert.equal(created.status,201);
    assert.equal(created.source.max_points,null);
    const sid = created.source.id;
    assert.equal((await request('PATCH',id,`/${sid}`,{question_count:3})).source.max_points,null);
    assert.equal((await request('GET',id,`/${sid}`)).source.max_points,null);
    assert.equal((await request('GET',id)).sources[0].max_points,null);
    assert.equal((await request('PATCH',id,`/${sid}`,{max_points:2.5})).source.max_points,2.5);
    assert.equal((await request('PATCH',id,`/${sid}`,{max_points:null})).source.max_points,null);
    const replaced = await put(id,[{category_id:cat,question_count:2,max_points:null},{category_id:null,question_count:1}]);
    assert.equal(replaced.status,200);
    assert.equal(replaced.sources.find(s => s.category_id===cat).max_points,null);
    assert.equal(replaced.sources.find(s => s.category_id===null).max_points,1);
    const sql = (await readFile(new URL('../src/database/migrations/1792540800001_nullable-quiz-source-max-points.sql', import.meta.url),'utf8')).replaceAll('public.',`${schema}.`);
    const [up,down] = sql.split('-- Down Migration');
    await admin.query(down);
    assert.equal((await request('GET',id)).sources.find(s => s.category_id===cat).max_points,1);
    await admin.query(up);
    const restored = (await request('GET',id)).sources.find(s => s.category_id===cat);
    assert.equal((await request('PATCH',id,`/${restored.id}`,{max_points:null})).source.max_points,null);
  });

  await t.test('fixed-layout migration rollback restores count allocations and reapplies', async () => {
    const id = await quiz(), a = await category();
    await put(id, [count(a, 10)]);
    await admin.query(migration.split('-- Down Migration')[1]);
    assert.equal((await admin.query('SELECT * FROM question_categories WHERE id=$1', [a])).rowCount, 1);
    await admin.query(migration.split('-- Down Migration')[0]);
    assert.equal((await request('GET', id)).sources[0].category_id, a);
  });
});
