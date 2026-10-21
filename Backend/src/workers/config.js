function enabled(env, name) {
  const value = env[name]?.trim().toLowerCase();
  if (!value) return true;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

function positiveInteger(env, name, fallback, maximum) {
  const value = env[name]?.trim();
  if (!value) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }
  return Number(value);
}

export function readWorkerConfig(env = process.env) {
  return {
    videoIndexing: { enabled: enabled(env, 'WORKER_VIDEO_INDEXING_ENABLED'), intervalMs: 2000, retryDelayMs: 5000 },
    quizExpiration: {
      enabled: enabled(env, 'WORKER_QUIZ_EXPIRATION_ENABLED'),
      intervalMs: positiveInteger(env, 'WORKER_QUIZ_EXPIRATION_INTERVAL_MS', 30000, 2147483647),
      batchSize: positiveInteger(env, 'WORKER_QUIZ_EXPIRATION_BATCH_SIZE', 250, 1000),
      retryDelayMs: 5000,
    },
  };
}
