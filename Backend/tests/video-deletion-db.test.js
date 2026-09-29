import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mock, test } from 'node:test';
import pg from 'pg';
import { prepareLiveSchema } from './helpers/live-stream-schema.js';

test('live deletion cascades to all recordings while individual deletion preserves the parent and siblings', {skip:!process.env.TEST_DATABASE_URL}, async t=>{
  const client=new pg.Client({connectionString:process.env.TEST_DATABASE_URL,connectionTimeoutMillis:5000,statement_timeout:10000});
  await client.connect();t.after(()=>client.end());await prepareLiveSchema(client);
  await client.query('CREATE TEMP TABLE video_reactions(video_id uuid REFERENCES pg_temp.videos(id) ON DELETE CASCADE, reaction text)');
  const query=(sql,values)=>client.query(sql.replaceAll('public.','pg_temp.'),values);
  mock.module(new URL('../src/database/index.js',import.meta.url).href,{namedExports:{writePool:{query,async connect(){return {query,release(){}};}}}});
  const calls=[];let status=404;
  const oldBase=process.env.R2_PUBLIC_BASE_URL,oldBucket=process.env.R2_BUCKET;
  process.env.R2_PUBLIC_BASE_URL='https://r2.example.test';process.env.R2_BUCKET='test-bucket';
  t.after(()=>{
    if(oldBase===undefined)delete process.env.R2_PUBLIC_BASE_URL;else process.env.R2_PUBLIC_BASE_URL=oldBase;
    if(oldBucket===undefined)delete process.env.R2_BUCKET;else process.env.R2_BUCKET=oldBucket;
  });
  const storageCalls=[];let failStorage=false;
  mock.module(new URL('../src/modules/storage/r2.client.js',import.meta.url).href,{namedExports:{s3:{async send(command){
    storageCalls.push(command.input.Key);
    if(failStorage)throw new Error('R2 unavailable');
  }}}});
  function missing(id){calls.push(id);throw Object.assign(new Error('Mock Mux error'),{status});}
  mock.module('@mux/mux-node',{defaultExport:class{video={liveStreams:{retrieve:missing,disable:missing,delete:missing},assets:{list:()=>({asResponse:async()=>Response.json({data:[],next_cursor:null})}),delete:missing}};}});
  const {deleteLiveStreamInternal:deleteLive}=await import('../src/modules/live-streams/handlers/deleteLiveStream.js');
  const {deleteVideoInternal:deleteVideo}=await import('../src/modules/videos/video-moderation/handlers/deleteVideo.js');
  const {handleLiveStreamMuxEvent:handle}=await import('../src/modules/live-streams/handlers/handleMuxEvent.js');
  const owner=randomUUID();await client.query('INSERT INTO pg_temp.users VALUES ($1)',[owner]);
  const {rows:[live]}=await client.query(`INSERT INTO pg_temp.live_streams(user_id,title,mux_live_stream_id,mux_live_playback_id)
    VALUES ($1,'Live','missing-stream','playback') RETURNING id`,[owner]);
  const insert=`INSERT INTO pg_temp.videos(live_stream_id,mux_asset_id) VALUES ($1,$2) RETURNING id`;
  const {rows:[first]}=await client.query(insert,[live.id,'first-asset']);
  const {rows:[second]}=await client.query(insert,[live.id,'second-asset']);
  const liveKey=`live-stream-thumbnails/${live.id}/source.webp`,recordingKey=`video-thumbnails/${second.id}/copy.webp`;
  await client.query('UPDATE pg_temp.live_streams SET thumbnail_url=$1 WHERE id=$2',[`https://r2.example.test/${liveKey}`,live.id]);
  await client.query('UPDATE pg_temp.videos SET thumbnail_url=$1 WHERE id=$2',[`https://r2.example.test/${recordingKey}`,second.id]);
  await client.query("INSERT INTO pg_temp.video_reactions VALUES ($1,'like'),($2,'like')",[first.id,second.id]);
  await assert.rejects(deleteLive(live.id,randomUUID()),{status:404});assert.deepEqual(calls,[]);
  status=503;await assert.rejects(deleteLive(live.id,owner),{status:502});
  assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_temp.videos')).rows[0].n,2);
  status=404;calls.length=0;
  await deleteVideo({params:{videoId:first.id}});
  assert.deepEqual(calls,['first-asset']);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_temp.live_streams')).rows[0].n,1);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_temp.videos')).rows[0].n,1);
  for(const liveId of ['missing-stream',undefined]){
    await handle({type:'video.asset.ready',created_at:'2026-09-28T10:00:00Z',data:{id:'first-asset',live_stream_id:liveId}});
  }
  assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_temp.videos')).rows[0].n,1);
  failStorage=true;
  await assert.rejects(deleteLive(live.id,owner),{status:502,message:'Unable to delete livestream thumbnails from R2'});
  assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_temp.live_streams')).rows[0].n,1);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_temp.videos')).rows[0].n,1);
  failStorage=false;storageCalls.length=0;
  await deleteLive(live.id,owner);
  assert.deepEqual(storageCalls.sort(),[liveKey,recordingKey].sort());
  assert.ok(calls.includes('second-asset'));
  for(const table of ['live_streams','videos','video_reactions'])assert.equal((await client.query(`SELECT count(*)::int AS n FROM pg_temp.${table}`)).rows[0].n,0);
  const {rows:[vod]}=await client.query("INSERT INTO pg_temp.videos(mux_asset_id) VALUES ('missing-vod') RETURNING id");
  await deleteVideo({params:{videoId:vod.id}});
  assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_temp.videos')).rows[0].n,0);
});
