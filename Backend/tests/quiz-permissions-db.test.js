import { upgradeFixedQuizLayout } from './helpers/fixed-quiz-schema.js';
import { upgradeQuizCertificates } from './helpers/quiz-certificate-schema.js';
import { upgradeQuestionCategories } from './helpers/question-categories-schema.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { mock, test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { installQuizPermissions } from './helpers/quiz-permissions-schema.js';
import { errorHandler } from '../src/middleware/error-handler.js';

test('quiz authorization uses real role grants, denies and Owner bypass on all module routes', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  await client.connect();
  t.after(() => client.end());
  await client.query('SET search_path TO pg_temp,public');
  await client.query("CREATE TEMP TABLE users(id uuid PRIMARY KEY,status text DEFAULT 'active',authz_version integer DEFAULT 1,full_name text)");
  await client.query(`CREATE TEMP TABLE videos (
    id uuid PRIMARY KEY, uploaded_by uuid REFERENCES users(id), title text, thumbnail_url text,
    mux_thumbnail_time double precision, mux_playback_id text, playback_policy text DEFAULT 'public',
    mux_status text DEFAULT 'ready', visibility text DEFAULT 'public', published_at timestamptz DEFAULT now(),
    duration_seconds integer, view_count integer DEFAULT 0, created_at timestamptz DEFAULT now()
  );
  CREATE TEMP TABLE watch_progress(user_id uuid,video_id uuid,progress_seconds integer,percentage_watched numeric,total_watch_seconds numeric DEFAULT 0,PRIMARY KEY(user_id,video_id));
  CREATE TEMP TABLE people(id uuid PRIMARY KEY,name text,image_url text);
  CREATE TEMP TABLE video_chairs(video_id uuid,person_id uuid,type text);`);
  for (const file of ['1791590400001_add-questions.sql','1791590400002_add-question-timestamps.sql','1791590400003_add-question-groups.sql',
    '1791590400004_add-quizzes.sql','1791763200000_add-quiz-requirements.sql', '1792627200000_add-quiz-requirements-is-active.sql','1792195200000_add-quiz-feedback-and-scoring-settings.sql', '1792627200001_add-quiz-questions-per-page.sql',
    '1792195200001_add-quiz-attempts.sql','1792195200002_add-quiz-attempt-questions-and-answers.sql',
    '1792281600000_add-quiz-questions.sql','1792281600001_add-quiz-sources.sql']) {
    const sql = await readFile(new URL(`../src/database/migrations/${file}`, import.meta.url),'utf8');
    await client.query(sql.split('-- Down Migration')[0].replaceAll('public.','pg_temp.'));
  }
  const viewer = randomUUID(), uploader = randomUUID(), admin = randomUUID(), owner = randomUUID(), unprivileged = randomUUID();
  for (const id of [viewer,uploader,admin,owner,unprivileged]) await client.query('INSERT INTO users(id) VALUES ($1)',[id]);
  await installQuizPermissions(client,{ defaultRole: null });
  await upgradeQuestionCategories(client);
  await upgradeFixedQuizLayout(client);
  await upgradeQuizCertificates(client);
  for (const [id,role] of [[viewer,'Viewer'],[uploader,'Uploader'],[admin,'Administrator'],[owner,'Owner']]) {
    await client.query('INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE name=$2',[id,role]);
  }
  const query = (sql,params) => client.query(sql.replaceAll('public.','pg_temp.'),params);
  mock.module(new URL('../src/database/index.js',import.meta.url).href,{ namedExports:{ writePool:{ query, async connect(){ return { query,release(){} }; } } } });
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'quiz-permissions-test';
  t.after(()=>{ if(previous===undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET=previous; });
  const { default: router } = await import('../src/modules/quizzes-engine/quizzes-engine.routes.js');
  const app = express(); app.use(express.json()); app.use('/api/quizzes',router); app.use(errorHandler);
  const server = app.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  async function request(user,method,path,body){
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/quizzes${path}`,{
      method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${jwt.sign({sub:user,authzVersion:1},process.env.JWT_SECRET)}`},
      body:body===undefined || method==='GET'?undefined:JSON.stringify(body),
    });
    return { ...await response.json(),status:response.status };
  }
  async function fixture(user=uploader){
    const quiz=randomUUID(),question=randomUUID(),category=randomUUID(),video=randomUUID();
    await client.query("INSERT INTO pg_temp.quizzes(id,user_id,title,question_count,status) VALUES ($1,$2,'Quiz',1,'published')",[quiz,user]);
    await client.query("INSERT INTO pg_temp.questions(id,user_id,type,content) VALUES ($1,$2,'single_choice','Question')",[question,user]);
    await client.query("INSERT INTO pg_temp.question_options VALUES ($1,1,'Correct',true,1),($1,2,'Incorrect',false,2)",[question]);
    await client.query('INSERT INTO pg_temp.question_categories(id,user_id,name) VALUES ($1,$2,$3)',[category,user,category]);
    await client.query("INSERT INTO videos(id,uploaded_by,duration_seconds,title) VALUES ($1,$2,120,'Video')",[video,user]);
    return {quiz,question,category,video};
  }
  const f=await fixture(),v=await fixture(viewer);
  const authorRoutes = x => [
    ['POST','/',{title:'New'}],['GET','/'],['GET',`/${x.quiz}`],['PATCH',`/${x.quiz}`,{title:'Changed'}],['DELETE',`/${x.quiz}`],
    ['POST','/questions',{type:'single_choice',content:'New'}],['GET','/questions'],['GET',`/questions/${x.question}`],['PATCH',`/questions/${x.question}`,{content:'Changed'}],['DELETE',`/questions/${x.question}`],
    ['POST','/question-categories',{name:'New'}],['GET','/question-categories'],['GET',`/question-categories/${x.category}`],['PATCH',`/question-categories/${x.category}`,{name:'Changed'}],['DELETE',`/question-categories/${x.category}`],['PUT',`/question-categories/${x.category}/questions`,{question_ids:[]}],
    ['POST','/quiz-requirements',{quiz_id:x.quiz,video_id:x.video,min_watch_seconds:1}],['GET','/quiz-requirements'],['GET',`/quiz-requirements/${x.quiz}/${x.video}`],['PATCH',`/quiz-requirements/${x.quiz}/${x.video}`,{position:1}],['DELETE',`/quiz-requirements/${x.quiz}/${x.video}`],
    ['POST',`/${x.quiz}/questions`,{question_id:x.question}],['GET',`/${x.quiz}/questions`],['GET',`/${x.quiz}/questions/${x.question}`],['PATCH',`/${x.quiz}/questions/${x.question}`,{position:1}],['DELETE',`/${x.quiz}/questions/${x.question}`],
    ['POST',`/${x.quiz}/sources`,{category_id:x.category,question_count:1}],['PUT',`/${x.quiz}/sources`,{sources:[]}],['GET',`/${x.quiz}/sources`],['GET',`/${x.quiz}/sources/${x.category}`],['PATCH',`/${x.quiz}/sources/${x.category}`,{position:1}],['DELETE',`/${x.quiz}/sources/${x.category}`],
  ];
  const participantRoutes = x => [['GET','/published'],['GET',`/published/${x.quiz}`],['GET',`/${x.quiz}/eligibility`],['POST',`/${x.quiz}/attempts`],['GET',`/quiz-requirements/${x.quiz}/check`],['GET',`/quiz-requirements/${x.quiz}/progress`]];

  await t.test('no-role users are blocked on every route; Viewer cannot author even resources they own',async()=>{
    for(const [method,path,body] of [...authorRoutes(f),...participantRoutes(f)]) assert.equal((await request(unprivileged,method,path,body)).status,403,`${method} ${path}`);
    for(const [method,path,body] of authorRoutes(v)) assert.equal((await request(viewer,method,path,body)).status,403,`${method} ${path}`);
  });
  await t.test('Uploader own permissions do not permit foreign reads, edits or membership changes',async()=>{
    for(const [method,path,body] of authorRoutes(v).filter(([method,path])=>path.includes(v.quiz)||path.includes(v.question)||path.includes(v.category))) {
      assert.equal((await request(uploader,method,path,body)).status,404,`${method} ${path}`);
    }
    for(const [path,key] of [['/','quizzes'],['/questions','questions'],['/question-categories','categories']]){
      const result=await request(uploader,'GET',path);
      assert.equal(result.status,200);
      assert.ok(result[key].every(row=>row.user_id===uploader));
    }
  });
  async function manageForeign(actor){
    const x=await fixture();
    assert.equal((await request(actor,'PATCH',`/${x.quiz}`,{title:'Managed'})).quiz.user_id,uploader);
    assert.equal((await request(actor,'PATCH',`/questions/${x.question}`,{content:'Managed'})).question.user_id,uploader);
    assert.equal((await request(actor,'PATCH',`/question-categories/${x.category}`,{name:randomUUID()})).category.user_id,uploader);
    assert.equal((await request(actor,'PUT',`/question-categories/${x.category}/questions`,{question_ids:[x.question]})).status,200);
    assert.equal((await request(actor,'POST',`/${x.quiz}/questions`,{question_id:x.question})).status,201);
    const createdSource = await request(actor,'POST',`/${x.quiz}/sources`,{category_id:x.category,question_count:1});
    assert.equal(createdSource.status,201); x.source=createdSource.source.id;
    assert.equal((await request(actor,'POST','/quiz-requirements',{quiz_id:x.quiz,video_id:x.video,min_watch_seconds:1})).status,201);
    for(const path of [`/${x.quiz}`,`/questions/${x.question}`,`/question-categories/${x.category}`,`/${x.quiz}/questions`, `/${x.quiz}/questions/${x.question}`,`/${x.quiz}/sources`,`/${x.quiz}/sources/${x.source}`,`/quiz-requirements?quiz_id=${x.quiz}`,`/quiz-requirements/${x.quiz}/${x.video}`]) {
      assert.equal((await request(actor,'GET',path)).status,200,path);
    }
    for(const path of [`/${x.quiz}/questions/${x.question}`,`/${x.quiz}/sources/${x.source}`,`/quiz-requirements/${x.quiz}/${x.video}`]) assert.equal((await request(actor,'PATCH',path,{position:2})).status,200,path);
    const replaced = await request(actor,'PUT',`/${x.quiz}/sources`,{sources:[{category_id:x.category,question_count:1}]});
    assert.equal(replaced.status,200); x.source=replaced.sources[0].id;
    for(const path of [`/${x.quiz}/sources/${x.source}`,`/${x.quiz}/questions/${x.question}`,`/quiz-requirements/${x.quiz}/${x.video}`,`/question-categories/${x.category}`,`/questions/${x.question}`,`/${x.quiz}`]) assert.equal((await request(actor,'DELETE',path)).status,200,path);
    for(const [path,key] of [['/','quizzes'],['/questions','questions'],['/question-categories','categories']]) {
      const result=await request(actor,'GET',path);
      assert.equal(result.status,200); assert.ok(result[key].some(row=>row.user_id===viewer));
    }
    for(const [path,body,key] of [['/',{title:'Created'},'quiz'],['/questions',{type:'single_choice',content:'Created'},'question'],['/question-categories',{name:randomUUID()},'category']]) {
      const created=await request(actor,'POST',path,body); assert.equal(created.status,201); assert.equal(created[key].user_id,actor);
    }
  }
  await t.test('Administrator and Owner can filter management lists by author; Viewer filters only published lists', async()=>{
    for (const actor of [admin, owner]) {
      const filtered = await request(actor, 'GET', `/?user_id=${viewer}`);
      assert.equal(filtered.status, 200);
      assert.ok(filtered.quizzes.length > 0);
      assert.ok(filtered.quizzes.every(q => q.user_id === viewer));
      assert.equal(filtered.pagination.total, filtered.quizzes.length);
      const absent = await request(actor, 'GET', `/?user_id=${randomUUID()}`);
      assert.equal(absent.pagination.total, 0);
    }
    const published = await request(viewer, 'GET', `/published?user_id=${uploader}`);
    assert.equal(published.status, 200);
    assert.ok(published.quizzes.some(q => q.id === f.quiz));
    assert.ok(published.quizzes.every(q => q.status === 'published' && q.id !== v.quiz));
    assert.equal((await request(viewer, 'GET', `/?user_id=${uploader}`)).status, 403);
  });

  await t.test('Administrator any permissions manage foreign resources and preserve their owners',()=>manageForeign(admin));
  await t.test('foreign quiz editors select their own or system templates and preserve assignment in attempts', async () => {
    const templates = new Map();
    for (const user of [admin, owner, uploader, viewer]) {
      const { rows } = await client.query(`INSERT INTO pg_temp.certificate_templates(user_id,name,html_template)
        VALUES ($1,'Private','<p>{{user.full_name}}</p>') RETURNING id`, [user]);
      templates.set(user, rows[0].id);
    }
    const system = (await client.query('SELECT id FROM pg_temp.certificate_templates WHERE is_system=true LIMIT 1')).rows[0].id;
    for (const actor of [admin, owner]) {
      const x = await fixture();
      const patch = (user, body) => request(user, 'PATCH', `/${x.quiz}`, body);
      for (const templateId of [system, templates.get(actor)]) {
        const result = await patch(actor, { certificate_template_id: templateId });
        assert.equal(result.status, 200);
        assert.equal(result.quiz.user_id, uploader);
        assert.equal(result.quiz.certificate_template_id, templateId);
      }
      // Neither administrative edit access nor quiz ownership grants access to another user's private template.
      for (const templateId of [templates.get(uploader), templates.get(viewer), randomUUID()]) {
        assert.equal((await patch(actor, { certificate_template_id: templateId })).status, 422);
      }
      assert.equal((await patch(uploader, { certificate_template_id: templates.get(actor) })).status, 422);
      assert.equal((await patch(viewer, { certificate_template_id: templates.get(viewer) })).status, 403);
      assert.equal((await patch(actor, { certificate_template_id: 'invalid' })).status, 400);
      // The quiz owner can edit other fields without being able to select the assigned private template.
      const renamed = await patch(uploader, { title: 'Selection preserved' });
      assert.equal(renamed.status, 200);
      assert.equal(renamed.quiz.certificate_template_id, templates.get(actor));
      assert.equal(renamed.quiz.user_id, uploader);

      await client.query('INSERT INTO pg_temp.quiz_questions(quiz_id,question_id) VALUES ($1,$2)', [x.quiz, x.question]);
      assert.equal((await request(viewer, 'POST', `/${x.quiz}/attempts`)).status, 201);
      const attempt = (await client.query('SELECT settings_snapshot FROM pg_temp.quiz_attempts WHERE quiz_id=$1', [x.quiz])).rows[0];
      assert.equal(attempt.settings_snapshot.certificate_template_id, templates.get(actor));
      const { getCertificateTemplate } = await import('../src/modules/certificates/certificate-templates/repository/certificate-templates.repository.js');
      assert.equal(await getCertificateTemplate({ query }, templates.get(actor), uploader), null);
      assert.equal(await getCertificateTemplate({ query }, templates.get(actor), viewer), null);
      const template = await getCertificateTemplate({ query }, templates.get(actor), actor);
      const { buildPreviewDocument } = await import('../src/modules/certificates/certificate-templates/helpers/previewDocument.js');
      assert.match(buildPreviewDocument(template).html, /John Anderson/);

      const cleared = await patch(uploader, { certificate_template_id: null });
      assert.equal(cleared.status, 200);
      assert.equal(cleared.quiz.certificate_template_id, null);
      assert.equal(cleared.quiz.user_id, uploader);
      assert.equal((await request(viewer, 'POST', `/${x.quiz}/attempts`)).status, 200);
      const resumed = (await client.query('SELECT settings_snapshot FROM pg_temp.quiz_attempts WHERE quiz_id=$1', [x.quiz])).rows[0];
      assert.equal(resumed.settings_snapshot.certificate_template_id, templates.get(actor));
    }
    assert.equal((await request(uploader, 'PATCH', `/${v.quiz}`, { certificate_template_id: templates.get(uploader) })).status, 404);
  });
  await t.test('Owner has full access even when a second role explicitly denies every quiz permission',async()=>{
    const {rows}=await client.query("INSERT INTO roles(name) VALUES ('Deny all') RETURNING id");
    await client.query("INSERT INTO role_permissions SELECT $1,id,'deny' FROM permissions",[rows[0].id]);
    await client.query('INSERT INTO user_roles(user_id,role_id) VALUES ($1,$2)',[owner,rows[0].id]);
    await manageForeign(owner);
    const x=await fixture();
    await client.query('INSERT INTO pg_temp.quiz_questions(quiz_id,question_id) VALUES ($1,$2)',[x.quiz,x.question]);
    for(const [method,path] of participantRoutes(x)) { const response=await request(owner,method,path); assert.ok([200,201].includes(response.status),JSON.stringify(response)); }
  });
  await t.test('Viewer participation uses only the authenticated user for attempts and watch progress',async()=>{
    await client.query('INSERT INTO pg_temp.quiz_questions(quiz_id,question_id) VALUES ($1,$2)',[f.quiz,f.question]);
    for(const [method,path] of participantRoutes(f)) { const response=await request(viewer,method,path,{user_id:uploader}); assert.ok([200,201].includes(response.status),JSON.stringify(response)); }
    const attempt=(await client.query('SELECT user_id FROM pg_temp.quiz_attempts WHERE quiz_id=$1',[f.quiz])).rows[0];
    assert.equal(attempt.user_id,viewer);
    await client.query('INSERT INTO pg_temp.quiz_requirements(quiz_id,video_id,min_watch_seconds) VALUES ($1,$2,60)',[f.quiz,f.video]);
    await client.query('INSERT INTO watch_progress(user_id,video_id,total_watch_seconds) VALUES ($1,$2,100)',[uploader,f.video]);
    assert.equal((await request(viewer,'GET',`/quiz-requirements/${f.quiz}/check`)).requirements_met,false);
  });
  await t.test('deny beats allow for non-owners, and expired grants do not confer access',async()=>{
    const {rows}=await client.query("INSERT INTO roles(name) VALUES ('Participation deny') RETURNING id");
    await client.query("INSERT INTO role_permissions SELECT $1,id,'deny' FROM permissions WHERE key='quizzes.participate'",[rows[0].id]);
    await client.query('INSERT INTO user_roles(user_id,role_id) VALUES ($1,$2)',[viewer,rows[0].id]);
    for(const [method,path] of participantRoutes(f)) assert.equal((await request(viewer,method,path)).status,403);
    await client.query("INSERT INTO user_roles(user_id,role_id,expires_at) SELECT $1,id,now()-interval '1 second' FROM roles WHERE name='Administrator'",[unprivileged]);
    assert.equal((await request(unprivileged,'GET','/')).status,403);
  });
  await t.test('any-only permission works without own permission and does not imply other operations',async()=>{
    const {rows}=await client.query("INSERT INTO roles(name) VALUES ('Quiz reader') RETURNING id");
    await client.query("INSERT INTO role_permissions SELECT $1,id,'allow' FROM permissions WHERE key='quizzes.read_any'",[rows[0].id]);
    await client.query('INSERT INTO user_roles(user_id,role_id) VALUES ($1,$2)',[unprivileged,rows[0].id]);
    assert.equal((await request(unprivileged,'GET',`/${v.quiz}`)).status,200);
    assert.equal((await request(unprivileged,'GET','/')).status,200);
    assert.equal((await request(unprivileged,'PATCH',`/${v.quiz}`,{title:'Forbidden'})).status,403);
    assert.equal((await request(unprivileged,'GET',`/questions/${v.question}`)).status,403);
  });
});
