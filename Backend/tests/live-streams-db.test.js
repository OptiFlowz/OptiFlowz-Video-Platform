import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mock, test } from 'node:test';
import pg from 'pg';
import { prepareLiveSchema } from './helpers/live-stream-schema.js';

test('migration preserves existing recording data and new streams own zero or many videos', {skip:!process.env.TEST_DATABASE_URL}, async t => {
  const client=new pg.Client({connectionString:process.env.TEST_DATABASE_URL,connectionTimeoutMillis:5000,statement_timeout:10000});
  await client.connect(); t.after(()=>client.end());
  const owner=randomUUID(), oldVideo=randomUUID(), oldStream=randomUUID();
  await prepareLiveSchema(client, async()=>{
    await client.query('INSERT INTO pg_temp.users VALUES ($1)',[owner]);
    await client.query(`INSERT INTO pg_temp.videos(id,uploaded_by,title,description,visibility,playback_policy,mux_asset_id,like_count)
      VALUES ($1,$2,'Existing','Description','unlisted','signed','old-asset',7)`,[oldVideo,owner]);
    await client.query(`INSERT INTO pg_temp.live_streams(id,video_id,mux_live_stream_id,mux_live_playback_id,completed_at)
      VALUES ($1,$2,'old-mux','old-playback','2026-01-01')`,[oldStream,oldVideo]);
  });
  const migrated=(await client.query('SELECT * FROM pg_temp.videos WHERE id=$1',[oldVideo])).rows[0];
  assert.equal(migrated.live_stream_id,oldStream);assert.equal(migrated.like_count,7);
  assert.ok(migrated.mux_recording_completed_at);
  const parent=(await client.query('SELECT * FROM pg_temp.live_streams WHERE id=$1',[oldStream])).rows[0];
  assert.equal(parent.user_id,owner);assert.equal(parent.title,'Existing');assert.equal(parent.visibility,'unlisted');
  assert.ok(!('video_id' in parent));
  let fail=false, sequence=0;const deleted=[];
  mock.module(new URL('../src/database/index.js',import.meta.url).href,{namedExports:{writePool:{async connect(){return {
    async query(sql,values){if(fail&&sql.includes('INSERT INTO public.live_streams'))throw new Error('Injected insert failure');return client.query(sql.replaceAll('public.','pg_temp.'),values);},release(){}
  };}}}});
  mock.module('@mux/mux-node',{defaultExport:class{video={liveStreams:{async create(p){return {id:`mux-${++sequence}`,stream_key:'key',playback_ids:[{id:'playback',policy:p.playback_policies[0]}]};},async delete(id){deleted.push(id);}}};}});
  const {createLiveStreamInternal:create}=await import('../src/modules/live-streams/handlers/createLiveStream.js');
  const result=await create({title:'New live',visibility:'unlisted',playback_policy:'signed'},owner);
  assert.equal(result.video,undefined);assert.equal(result.live_stream.user_id,owner);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_temp.videos WHERE live_stream_id=$1',[result.live_stream.id])).rows[0].n,0);
  const insert=`INSERT INTO pg_temp.videos(live_stream_id,mux_asset_id) VALUES ($1,$2) RETURNING id`;
  const first=(await client.query(insert,[result.live_stream.id,'a'])).rows[0];
  await client.query(insert,[result.live_stream.id,'b']);
  await assert.rejects(client.query(insert,[result.live_stream.id,'a']),{code:'23505'});
  await assert.rejects(client.query(insert,[randomUUID(),'c']),{code:'23503'});
  await client.query('DELETE FROM pg_temp.videos WHERE id=$1',[first.id]);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_temp.live_streams WHERE id=$1',[result.live_stream.id])).rows[0].n,1);
  await client.query('DELETE FROM pg_temp.live_streams WHERE id=$1',[result.live_stream.id]);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_temp.videos WHERE live_stream_id=$1',[result.live_stream.id])).rows[0].n,0);
  fail=true;await assert.rejects(create({title:'Rollback'},owner),/Injected/);assert.deepEqual(deleted,['mux-2']);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_temp.live_streams')).rows[0].n,1);
});
