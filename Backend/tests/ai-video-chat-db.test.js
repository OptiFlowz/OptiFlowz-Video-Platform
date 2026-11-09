import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import express from 'express';
import pg from 'pg';

test('AI video chat retrieves and filters indexed sources from the requested public videos', {
  skip: !process.env.TEST_DATABASE_URL,
}, async t => {
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  t.after(() => client.end());
  await client.query(`
    CREATE TEMP TABLE videos (id uuid, title text, duration_seconds int, mux_status text,
      visibility text, published_at timestamptz DEFAULT now());
    CREATE TEMP TABLE video_indexing_sources (id uuid, indexed_revision int, enabled boolean);
    CREATE TEMP TABLE video_documents_pg (id uuid DEFAULT gen_random_uuid(), video_id uuid,
      source_id uuid, document_type text, source_revision int, language text DEFAULT 'en',
      text text, metadata jsonb DEFAULT '{}', start_seconds float8, end_seconds float8, embedding vector(1536),
      embedding_model text DEFAULT 'text-embedding-3-small', index_version int DEFAULT 1);
  `);
  const [lecture, panel, hidden, unrelated] = Array.from({ length: 4 }, () => randomUUID());
  const relevant = [1, ...Array(1535).fill(0)];
  const orthogonal = [0, 1, ...Array(1534).fill(0)];
  for (const id of [lecture, panel, hidden, unrelated]) {
    await client.query("INSERT INTO pg_temp.videos VALUES ($1,'Talk',80,'ready',$2,now())",
      [id, id === hidden ? 'private' : 'public']);
    await client.query('INSERT INTO pg_temp.video_indexing_sources VALUES ($1,2,true)', [id]);
    await client.query(`INSERT INTO pg_temp.video_documents_pg
      (video_id,source_id,document_type,source_revision,text,start_seconds,end_seconds,embedding)
      SELECT $1,$1,'transcript_chunk',2,'Speech ' || n,n*10,n*10+9.5,
        CASE WHEN n >= 6 THEN $2::vector ELSE $3::vector END
      FROM generate_series(0,7) AS n`, [id, JSON.stringify(relevant), JSON.stringify(orthogonal)]);
  }
  await client.query(`INSERT INTO pg_temp.video_documents_pg
    (video_id,source_id,document_type,source_revision,language,text,metadata,start_seconds,end_seconds,embedding)
    VALUES ($1,$1,'overview',2,'und','Overview','{"chapters":[1,2]}',NULL,NULL,$2::vector),
           ($1,$1,'transcript_chunk',2,'sr','Govor','{"speaker":"Ana"}',60,69.5,$2::vector),
           ($1,$1,'transcript_chunk',1,'en','Old revision','{}',5,6,$2::vector)`, [lecture, JSON.stringify(relevant)]);

  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.AI_TOOLS_BEARER_TOKEN = randomUUID();
  process.env.OPENAI_API_KEY = 'test';
  const { writePool } = await import('../src/database/index.js');
  t.mock.method(writePool, 'query', client.query.bind(client));
  const { default: router } = await import('../src/modules/ai/ai.routes.js');
  const app = express();
  app.use('/api/ai', express.json(), router);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const http = globalThis.fetch;
  let embeddingCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/embeddings');
    assert.deepEqual(JSON.parse(options.body).input, ['Where is the topic discussed?']);
    embeddingCalls++;
    return Response.json({ data: [{ index: 0, embedding: relevant }] });
  });
  function call(body, token = process.env.AI_TOOLS_BEARER_TOKEN) {
    return http(`http://127.0.0.1:${server.address().port}/api/ai/videos/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  }

  const request = { video_ids: [panel, lecture, hidden], question: 'Where is the topic discussed?' };
  assert.equal((await call(request, 'invalid')).status, 401);
  for (const invalid of [{ video_ids: [] }, { video_ids: ['invalid'] }, { question: ' ' }, { section: 'typo' },
    { language: ' ' }, { language: ['en'] }, { document_type: 'chapter' }]) {
    assert.equal((await call({ ...request, ...invalid })).status, 400);
  }
  assert.equal(embeddingCalls, 0);
  const response = await call(request);
  assert.equal(response.status, 200);
  const { sources } = await response.json();
  assert.deepEqual(sources.map(s => [s.video_id, s.document_type, s.start_seconds, s.end_seconds, s.text]), [
    [panel, 'transcript_chunk', 60, 69.5, 'Speech 6'], [panel, 'transcript_chunk', 70, 79.5, 'Speech 7'],
    [lecture, 'transcript_chunk', 60, 69.5, 'Speech 6'], [lecture, 'transcript_chunk', 70, 79.5, 'Speech 7'],
    [lecture, 'overview', null, null, 'Overview'],
  ]);
  assert.ok(sources.every(s => s.segment_id && s.video_title === 'Talk'));
  assert.deepEqual(sources[0].metadata, {});
  assert.deepEqual(sources.at(-1).metadata, { chapters: [1, 2] });
  const summary = await call({ ...request, video_ids: [lecture], mode: 'summary', section: 'second_half' });
  assert.deepEqual((await summary.json()).sources.map(s => s.start_seconds), [40, 50, 60, 70]);
  assert.equal(embeddingCalls, 1);
  for (const mode of ['semantic', 'summary']) {
    async function filtered(filters) {
      const response = await call({ ...request, mode, ...filters });
      assert.equal(response.status, 200);
      return (await response.json()).sources;
    }
    const serbian = await filtered({ language: ' SR ' });
    assert.equal(serbian.length, 1);
    assert.deepEqual([serbian[0].language, serbian[0].metadata], ['sr', { speaker: 'Ana' }]);
    const overviews = await filtered({ document_type: 'overview' });
    assert.deepEqual(overviews, [sources.at(-1)]);
    const chunks = await filtered({ document_type: 'transcript_chunk' });
    assert.ok(chunks.length > 0 && chunks.every(s => s.document_type === 'transcript_chunk'));
    assert.deepEqual(await filtered({ language: 'sr', document_type: 'overview' }), []);
    assert.deepEqual(await filtered({ section: 'first_half', document_type: 'overview' }), []);
  }
  await client.query('UPDATE pg_temp.video_indexing_sources SET enabled=false WHERE id=$1', [lecture]);
  const empty = await call({ ...request, video_ids: [lecture, hidden] });
  assert.deepEqual(await empty.json(), { sources: [] });
});
