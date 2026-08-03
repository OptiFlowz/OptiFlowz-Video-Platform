import jwt from 'jsonwebtoken';
import { writePool } from '../database/index.js';

async function authenticateToken(token) {
  const payload = jwt.verify(token, process.env.JWT_SECRET);

  const { rows } = await writePool.query(
    `
      SELECT id, status, authz_version
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [payload.sub],
  );

  const user = rows[0];

  if (!user || user.status !== 'active') {
    const error = new Error('Account is not active');
    error.code = 'ACCOUNT_INACTIVE';
    throw error;
  }

  if (
    payload.authzVersion !== undefined
    && payload.authzVersion !== user.authz_version
  ) {
    const error = new Error('Authorization changed; sign in again');
    error.code = 'AUTHORIZATION_CHANGED';
    throw error;
  }

  return {
    sub: user.id,
    authzVersion: user.authz_version,
  };
}

function bearerToken(req) {
  const authorization = req.headers.authorization || '';
  return authorization.startsWith('Bearer ')
    ? authorization.slice(7)
    : null;
}

export async function requireAuth(req, res, next) {
  const token = bearerToken(req);
  if (!token) return res.status(401).json({ message: 'Missing token' });

  try {
    req.user = await authenticateToken(token);
    return next();
  } catch (error) {
    const message = error.code === 'AUTHORIZATION_CHANGED'
      ? error.message
      : 'Invalid or expired token';
    return res.status(401).json({ message });
  }
}

export async function optionalAuth(req, res, next) {
  const authorization = req.headers.authorization || '';

  if (!authorization) {
    req.user = null;
    return next();
  }

  const token = bearerToken(req);
  if (!token) {
    return res.status(401).json({ message: 'Invalid authorization header' });
  }

  try {
    req.user = await authenticateToken(token);
    return next();
  } catch (error) {
    const message = error.code === 'AUTHORIZATION_CHANGED'
      ? error.message
      : 'Invalid or expired token';
    return res.status(401).json({ message });
  }
}
