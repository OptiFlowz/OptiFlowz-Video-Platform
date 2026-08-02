// src/modules/authorization/resource-authorization.js

import { writePool } from '../../database/index.js';
import {hasPermission,loadAuthorization,} from './authorization.service.js';

export function requireVideoAccess({
  ownPermission,
  anyPermission,
  idParameter = 'videoId',
}) {
  return async function videoAuthorization(req, res, next) {
    try {
      const videoId = req.params[idParameter];

      const { rows } = await writePool.query(
        `
          SELECT id, uploaded_by, visibility
          FROM videos
          WHERE id = $1
          LIMIT 1
        `,
        [videoId],
      );

      const video = rows[0];

      if (!video) {
        return res.status(404).json({
          message: 'Video not found',
        });
      }

      const authorization =
        req.authorization
        || await loadAuthorization(req.user.sub);

      const ownsVideo =
        video.uploaded_by === req.user.sub;

      const allowed =
        authorization.isOwner
        || hasPermission(authorization, anyPermission)
        || (
          ownsVideo
          && hasPermission(authorization, ownPermission)
        );

      if (!allowed) {
        return res.status(403).json({
          message: 'You cannot access this video',
        });
      }

      req.authorization = authorization;
      req.resource = video;

      next();
    } catch (error) {
      next(error);
    }
  };
}