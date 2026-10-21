import 'dotenv/config';
import { writePool, readPool } from '../database/index.js';
import { createWorkerRegistry } from './registry.js';
import { runWorkers } from './runLoop.js';

const shutdown = new AbortController();
const stop = () => shutdown.abort();
process.once('SIGTERM', stop);
process.once('SIGINT', stop);

try {
  await runWorkers(createWorkerRegistry(), { signal: shutdown.signal });
} finally {
  shutdown.abort();
  process.removeListener('SIGTERM', stop);
  process.removeListener('SIGINT', stop);
  await Promise.all([writePool.end(), readPool.end()]);
}
