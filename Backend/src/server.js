import './config/env.js';

import { createApp } from './app.js';
import { env } from './config/env.js';
import { logDbRolesOnce } from './database/index.js';

const app = createApp();

// Fly Proxy connects over IPv4; do not expose the API directly on private IPv6.
app.listen(env.port, '0.0.0.0', () => {
  console.log(`API running on http://localhost:${env.port}`);
});

await logDbRolesOnce();
