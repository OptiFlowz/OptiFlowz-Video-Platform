import express from 'express';

const defaultJsonParser = express.json({ limit: '100kb' });
const certificateJsonParser = express.json({ limit: '3mb' });
const muxWebhookJsonParser = express.raw({ type: 'application/json' });

export function conditionalJsonParser(req, res, next) {
  if (req.originalUrl.startsWith('/api/video-moderation/subtitle/replacev2/')) {
    return next();
  }

  if (req.originalUrl.startsWith('/api/videos/webhook/mux')) {
    return next();
  }

  // Certificate sources can contain embedded font files; keep the larger body limit scoped here.
  if (/^\/api\/certificates\/certificate-templates(?:\/|\?|$)/.test(req.originalUrl)) {
    return certificateJsonParser(req, res, next);
  }

  return defaultJsonParser(req, res, next);
}

export { muxWebhookJsonParser };
