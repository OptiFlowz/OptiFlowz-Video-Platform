import './config/env.js';

import { createApp } from './app.js';
import { env } from './config/env.js';
import { logDbRolesOnce, writePool, readPool } from './database/index.js';
import { startLivestreamLifecycle } from './modules/livestreams/lifecycle.scheduler.js';

const app = createApp();

let lifecycle;
const server = app.listen(env.port, () => {
  console.log(`API running on http://localhost:${env.port}`);
  if (process.env.MUX_TOKEN_ID && process.env.MUX_TOKEN_SECRET) {
    lifecycle = startLivestreamLifecycle();
  }
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  const deadline = setTimeout(() => process.exit(1), 30000);
  deadline.unref();
  try {
    await Promise.all([
      new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
      lifecycle?.stop(),
    ]);
    await Promise.all([...new Set([writePool, readPool])].map(pool => pool.end()));
    clearTimeout(deadline);
  } catch {
    console.error('API shutdown failed');
    process.exitCode = 1;
  }
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);

await logDbRolesOnce();
