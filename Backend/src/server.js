import './config/env.js';

import { createApp } from './app.js';
import { env } from './config/env.js';
import { logDbRolesOnce } from './database/index.js';

const app = createApp();

app.listen(env.port, () => {
  console.log(`API running on http://localhost:${env.port}`);
});

await logDbRolesOnce();
