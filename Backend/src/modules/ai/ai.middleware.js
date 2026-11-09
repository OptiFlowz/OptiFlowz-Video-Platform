import { timingSafeEqual } from 'node:crypto';

export function requireAiBearerToken(req, res, next) {
  const secret = process.env.AI_TOOLS_BEARER_TOKEN;
  if (!secret) {
    return res.status(503).json({ message: 'AI tools authentication is not configured' });
  }

  const match = /^Bearer +([^\s]+)$/i.exec(req.get('Authorization') || '');
  if (match) {
    const supplied = Buffer.from(match[1]);
    const expected = Buffer.from(secret);
    if (supplied.length === expected.length && timingSafeEqual(supplied, expected)) {
      res.locals.skipViewTracking = true;
      return next();
    }
  }

  return res.set('WWW-Authenticate', 'Bearer realm="ai-tools"')
    .status(401).json({ message: 'Valid AI tools bearer token required' });
}
