import express from 'express';
import cors from 'cors';

import { corsOptions } from './config/cors.js';
import { conditionalJsonParser, muxWebhookJsonParser } from './middleware/request-parsers.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { registerRoutes } from './routes/index.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', true);
  app.use(cors(corsOptions));
  app.use(conditionalJsonParser);
  app.use('/api/videos/webhook/mux', muxWebhookJsonParser);

  registerRoutes(app);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
