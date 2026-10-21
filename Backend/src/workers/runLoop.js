import { setTimeout } from 'node:timers/promises';

// Wait after each completed run, never overlap runs of the same job.
// Even an immediate next run yields to timers, shutdown and other jobs.
export async function runLoop(job, { signal, logger = console, sleep = setTimeout } = {}) {
  logger.log(`[${job.name}] worker started`);
  while (!signal.aborted) {
    let delay = job.intervalMs;
    try {
      const result = await job.run({ signal });
      if (result?.runAgainImmediately) delay = 0;
    } catch (error) {
      if (signal.aborted) break;
      logger.error(`[${job.name}] ${error.message}`);
      delay = job.retryDelayMs;
    }
    if (signal.aborted) break;
    try { await sleep(delay, undefined, { signal }); }
    catch (error) { if (!signal.aborted) throw error; }
  }
  logger.log(`[${job.name}] worker stopped`);
}

export async function runWorkers(jobs, options) {
  const enabled = jobs.filter(job => job.enabled);
  if (!enabled.length) (options.logger ?? console).log('[workers] no jobs enabled');
  // All loops settle before the caller closes shared database pools.
  const results = await Promise.allSettled(enabled.map(job => runLoop(job, options)));
  const failure = results.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
}
