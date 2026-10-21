import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readWorkerConfig } from '../src/workers/config.js';
import { createWorkerRegistry } from '../src/workers/registry.js';
import { runLoop, runWorkers } from '../src/workers/runLoop.js';
const logger = { log() {}, error() {} };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('worker configuration has usable defaults and rejects unsafe overrides', () => {
  assert.deepEqual(readWorkerConfig({}), {
    videoIndexing: { enabled:true, intervalMs:2000, retryDelayMs:5000 },
    quizExpiration: { enabled:true, intervalMs:30000, batchSize:250, retryDelayMs:5000 },
  });
  assert.equal(readWorkerConfig({WORKER_QUIZ_EXPIRATION_BATCH_SIZE:''}).quizExpiration.batchSize,250);
  const config = readWorkerConfig({WORKER_VIDEO_INDEXING_ENABLED:'false',WORKER_QUIZ_EXPIRATION_INTERVAL_MS:'1000',WORKER_QUIZ_EXPIRATION_BATCH_SIZE:'500'});
  assert.equal(config.videoIndexing.enabled,false);
  assert.equal(config.quizExpiration.intervalMs,1000);
  assert.equal(config.quizExpiration.batchSize,500);
  for (const env of [
    {WORKER_VIDEO_INDEXING_ENABLED:'yes'}, {WORKER_QUIZ_EXPIRATION_ENABLED:'0'},
    {WORKER_QUIZ_EXPIRATION_INTERVAL_MS:'0'}, {WORKER_QUIZ_EXPIRATION_INTERVAL_MS:'2147483648'},
    {WORKER_QUIZ_EXPIRATION_BATCH_SIZE:'-1'}, {WORKER_QUIZ_EXPIRATION_BATCH_SIZE:'2.5'},
    {WORKER_QUIZ_EXPIRATION_BATCH_SIZE:'1001'},
  ]) assert.throws(() => readWorkerConfig(env));
});

test('loop uses retry delays, interval and immediate work without overlapping runs', async () => {
  const controller = new AbortController(), delays=[], errors=[];
  let calls=0, running=0;
  const job={name:'test',intervalMs:30,retryDelayMs:5,async run(){
    assert.equal(++running,1);
    await Promise.resolve();
    running--;
    if (++calls===1) throw new Error('retry me');
    return {runAgainImmediately:calls===2};
  }};
  await runLoop(job,{signal:controller.signal,logger:{log(){},error:e=>errors.push(e)},sleep:async ms=>{
    delays.push(ms); if(delays.length===3) controller.abort();
  }});
  assert.deepEqual(delays,[5,0,30]);
  assert.equal(errors.length,1);
  assert.equal(calls,3);
});

test('long-running jobs do not block other loops, and shutdown waits for active work', async () => {
  const controller=new AbortController(), started=deferred(), release=deferred();
  let disabledRuns=0, fastRuns=0, finished=false;
  const running=runWorkers([
    {name:'slow',enabled:true,intervalMs:100000,retryDelayMs:5000,async run(){started.resolve(); await release.promise;}},
    {name:'fast',enabled:true,intervalMs:100000,retryDelayMs:5000,async run(){await started.promise; fastRuns++; controller.abort();}},
    {name:'disabled',enabled:false,async run(){disabledRuns++;}},
  ],{signal:controller.signal,logger}).then(()=>{finished=true;});
  await started.promise; await new Promise(resolve=>setImmediate(resolve));
  assert.equal(fastRuns,1); assert.equal(disabledRuns,0); assert.equal(finished,false);
  release.resolve(); await running; assert.equal(finished,true);
});

test('aborting interrupts interval waits without waiting for the polling period', async () => {
  const controller=new AbortController(), ran=deferred();
  const loop=runLoop({name:'idle',intervalMs:2147483647,retryDelayMs:5000,async run(){ran.resolve();}},{signal:controller.signal,logger});
  await ran.promise; await new Promise(resolve=>setImmediate(resolve));
  controller.abort(); await loop;
});

test('registry keeps video errors independent and advances expiration cursor only after successful batches', async () => {
  let imports=0, calls=0; const argumentsSeen=[];
  const cursor={expiresAt:'2026-01-01 00:00:00.000001+00',id:'x'};
  const jobs=createWorkerRegistry({env:{},logger,loadVideo:async()=>{imports++;},loadExpiration:async()=>({async expireAttempts(args){
    argumentsSeen.push(args); calls++;
    if(calls===2) throw new Error('database unavailable');
    return {scanned:250,finalized:250,failed:0,nextCursor:calls===1?cursor:null};
  }})});
  const signal=new AbortController().signal;
  await assert.rejects(jobs[0].run({signal}),/OPENAI_API_KEY/);
  assert.equal(imports,0);
  await jobs[1].run({signal});
  await assert.rejects(jobs[1].run({signal}),/database unavailable/);
  await jobs[1].run({signal});
  assert.equal(argumentsSeen[0].batchSize,250);
  assert.equal(argumentsSeen[0].cursor,null);
  assert.deepEqual(argumentsSeen[1].cursor,cursor);
  assert.deepEqual(argumentsSeen[2].cursor,cursor);
});

test('video adapter preserves claim/process behavior and disabled jobs are never imported', async () => {
  const signal=new AbortController().signal;
  const item={id:1}; let claims=0, processed=0;
  const jobs=createWorkerRegistry({env:{OPENAI_API_KEY:'test',WORKER_QUIZ_EXPIRATION_ENABLED:'false'},logger,
    loadVideo:async()=>({async claimJob(){return ++claims===1?item:null;},async processJob(job,received){assert.equal(job,item);assert.equal(received,signal);processed++;}}),
    loadExpiration:async()=>{throw new Error('disabled job loaded');},
  });
  assert.deepEqual(await jobs[0].run({signal}),{runAgainImmediately:true});
  assert.deepEqual(await jobs[0].run({signal}),{runAgainImmediately:false});
  assert.equal(processed,1); assert.equal(jobs[1].enabled,false);
  const disabled=createWorkerRegistry({env:{WORKER_VIDEO_INDEXING_ENABLED:'false',WORKER_QUIZ_EXPIRATION_ENABLED:'false'},logger});
  await runWorkers(disabled,{signal,logger});
});
