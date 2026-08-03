// src/modules/authorization/authorization.middleware.js

import {
  hasPermission,
  loadAuthorization,
} from './authorization.service.js';

export function requirePermission(permissionKey) {
  return async function permissionMiddleware(req, res, next) {
    try {
      const authorization =
        req.authorization
        || await loadAuthorization(req.user.sub);

      req.authorization = authorization;

      if (!hasPermission(authorization, permissionKey)) {
        return res.status(403).json({
          message: 'Insufficient permissions',
          requiredPermission: permissionKey,
        });
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
}
