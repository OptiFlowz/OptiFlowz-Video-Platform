import express from 'express';

const defaultJsonParser = express.json({ limit: '100kb' });
const muxWebhookJsonParser = express.raw({ type: 'application/json' });

export function conditionalJsonParser(req, res, next) {
  if (req.originalUrl.startsWith('/api/video-moderation/subtitle/replacev2/')) {
    return next();
  }

  if (req.originalUrl.startsWith('/api/videos/webhook/mux')) {
    return next();
  }

  return defaultJsonParser(req, res, next);
}

export { muxWebhookJsonParser };
