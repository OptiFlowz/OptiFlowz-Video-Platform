import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { setTimeout as delay, setImmediate as flush } from 'node:timers/promises';

mock.module(new URL('../src/database/index.js', import.meta.url).href, { namedExports: { writePool: {} } });
mock.module(new URL('../src/modules/livestreams/lifecycle.service.js', import.meta.url).href, { namedExports: { reconcileLivestream: async () => {} } });
const { startLivestreamLifecycle } = await import('../src/modules/livestreams/lifecycle.scheduler.js');

function fixture({ acquired = true, failQuery = false, failUnlock = false } = {}) {
  const calls = [];
  const client = {
    async query(sql) {
      if (sql.includes('pg_try_advisory_lock')) { calls.push('lock'); return { rows: [{ acquired }] }; }
      if (sql.includes('pg_advisory_unlock')) {
        calls.push('unlock');
        if (failUnlock) throw new Error('lost connection');
        return { rows: [] };
      }
      calls.push('select');
      if (failQuery) throw new Error('query failed');
      return { rows: [{ video_id: 'first' }, { video_id: 'second' }] };
    },
    release(error) { calls.push(error ? 'discard' : 'release'); },
  };
  return {
    calls,
    database: { async connect() { calls.push('connect'); return client; } },
    logger: { error(...args) { calls.push(['error', ...args]); } },
  };
}

test('another replica holding the lock skips the sweep and releases its connection', async () => {
  const f = fixture({ acquired: false });
  const job = startLivestreamLifecycle({ ...f, reconcile: async () => assert.fail('must not reconcile') });
  await flush();
  await job.stop();
  assert.deepEqual(f.calls, ['connect', 'lock', 'release']);
});

test('a failed stream does not prevent the next stream or leak the sweep lock', async () => {
  const f = fixture();
  const processed = [];
  const job = startLivestreamLifecycle({ ...f, reconcile: async id => {
    processed.push(id);
    if (id === 'first') throw Object.assign(new Error('provider credentials must not be logged'), { status: 502 });
  } });
  await flush();
  await job.stop();
  assert.deepEqual(processed, ['first', 'second']);
  assert.deepEqual(f.calls.slice(-2), ['unlock', 'release']);
  assert.ok(!JSON.stringify(f.calls).includes('provider credentials'));
});

test('shutdown waits for in-flight work, skips remaining rows and cancels future sweeps', async () => {
  const f = fixture();
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const processed = [];
  const job = startLivestreamLifecycle({ ...f, intervalMs: 5, reconcile: async id => { processed.push(id); await pending; } });
  await flush();
  let stopped = false;
  const stopping = job.stop().then(() => { stopped = true; });
  await flush();
  assert.equal(stopped, false);
  finish();
  await stopping;
  await delay(20);
  assert.deepEqual(processed, ['first']);
  assert.equal(f.calls.filter(c => c === 'connect').length, 1);
  assert.deepEqual(f.calls.slice(-2), ['unlock', 'release']);
});

test('slow reconciliation never starts an overlapping timer sweep', async () => {
  const f = fixture();
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const job = startLivestreamLifecycle({ ...f, intervalMs: 5, reconcile: () => pending });
  await delay(25);
  assert.equal(f.calls.filter(c => c === 'connect').length, 1);
  const stopping = job.stop();
  finish();
  await stopping;
});

test('database failure releases the lock and a later sweep retries', async () => {
  const f = fixture({ failQuery: true });
  const job = startLivestreamLifecycle({ ...f, intervalMs: 5 });
  await delay(30);
  await job.stop();
  assert.ok(f.calls.filter(c => c === 'select').length > 1);
  assert.equal(f.calls.filter(c => c === 'connect').length, f.calls.filter(c => c === 'release').length);
});

test('failed unlock destroys the connection instead of returning a held lock to the pool', async () => {
  const f = fixture({ failUnlock: true });
  const job = startLivestreamLifecycle({ ...f, reconcile: async () => {} });
  await flush();
  await job.stop();
  assert.equal(f.calls.at(-1), 'discard');
});
