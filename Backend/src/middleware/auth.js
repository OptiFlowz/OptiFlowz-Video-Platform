// src/middleware/auth.js

import jwt from 'jsonwebtoken';
import { writePool } from '../database/index.js';

export async function requireAuth(req, res, next) {
  const authorizationHeader = req.headers.authorization || '';

  const token = authorizationHeader.startsWith('Bearer ')
    ? authorizationHeader.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({ message: 'Missing token' });
  }

  try {
    const payload = jwt.verify(
      token,
      process.env.JWT_SECRET,
    );

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
      return res.status(401).json({
        message: 'Account is not active',
      });
    }

    if (
      payload.authzVersion !== undefined
      && payload.authzVersion !== user.authz_version
    ) {
      return res.status(401).json({
        message: 'Authorization changed; sign in again',
      });
    }

    req.user = {
      sub: user.id,
      authzVersion: user.authz_version,
    };

    next();
  } catch {
    return res.status(401).json({
      message: 'Invalid token',
    });
  }
}

export async function optionalAuth(req, res, next) {
  const authorization = req.headers.authorization || '';

  if (!authorization) {
    req.user = null;
    return next();
  }

  if (!authorization.startsWith('Bearer ')) {
    return res.status(401).json({
      message: 'Invalid authorization header',
    });
  }

  const token = authorization.slice(7);

  try {
    const payload = jwt.verify(
      token,
      process.env.JWT_SECRET,
    );

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
      return res.status(401).json({
        message: 'Account is not active',
      });
    }

    if (payload.authzVersion !== user.authz_version) {
      return res.status(401).json({
        message: 'Authorization changed; sign in again',
      });
    }

    req.user = {
      sub: user.id,
      authzVersion: user.authz_version,

      // Temporary, until requireAdmin is removed.
      role: payload.role,
    };

    return next();
  } catch {
    return res.status(401).json({
      message: 'Invalid or expired token',
    });
  }
}