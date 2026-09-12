import 'dotenv/config';
import { setTimeout } from 'node:timers/promises';
import { writePool, readPool } from '../database/index.js';
import { claimJob, processJob } from '../modules/video-indexing/indexing.worker.js';

if (!process.env.OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY');
const shutdown = new AbortController();
process.once('SIGTERM', () => shutdown.abort());
process.once('SIGINT', () => shutdown.abort());

try {
  console.log('[video-indexing] worker started');
  while (!shutdown.signal.aborted) {
    try {
      const job = await claimJob();
      if (job) await processJob(job, shutdown.signal);
      else await setTimeout(2000, undefined, { signal: shutdown.signal });
    } catch (error) {
      if (shutdown.signal.aborted) break;
      console.error(`[video-indexing] ${error.message}`);
      await setTimeout(5000, undefined, { signal: shutdown.signal }).catch(() => {});
    }
  }
} finally {
  await Promise.all([writePool.end(), readPool.end()]);
}
