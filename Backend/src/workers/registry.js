import { readWorkerConfig } from './config.js';

// Imports happen within each job: a missing optional dependency/credential in
// video indexing cannot stop quiz expiration or claim paid jobs without a key.
export function createWorkerRegistry({ env = process.env, logger = console,
  loadVideo = () => import('../modules/video-indexing/indexing.worker.js'),
  loadExpiration = () => import('../modules/quizzes-engine/quiz-attempts/workers/expireAttempts.js'),
} = {}) {
  const config = readWorkerConfig(env);
  let expirationCursor = null;
  return [
    {
      name: 'video-indexing', ...config.videoIndexing,
      async run({ signal }) {
        if (!env.OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY; video indexing cannot run');
        const { claimJob, processJob } = await loadVideo();
        signal.throwIfAborted();
        const job = await claimJob();
        if (job) await processJob(job, signal);
        return { runAgainImmediately: Boolean(job) };
      },
    },
    {
      name: 'quiz-expiration', ...config.quizExpiration,
      async run({ signal }) {
        const { expireAttempts } = await loadExpiration();
        const result = await expireAttempts({ signal, batchSize: config.quizExpiration.batchSize, cursor: expirationCursor, logger });
        expirationCursor = result.nextCursor;
        if (result.scanned) logger.log(`[quiz-expiration] scanned=${result.scanned} finalized=${result.finalized} failed=${result.failed}`);
      },
    },
  ];
}
