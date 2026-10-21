// Compatibility entrypoint for existing indexing-only scripts.
import 'dotenv/config';
process.env.WORKER_VIDEO_INDEXING_ENABLED = 'true';
process.env.WORKER_QUIZ_EXPIRATION_ENABLED = 'false';
await import('./index.js');
