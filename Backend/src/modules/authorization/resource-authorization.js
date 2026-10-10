import { writePool } from '../../database/index.js';
import {
  hasPermission,
  loadAuthorization,
} from './authorization.service.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readRequestId(req, source, name) {
  return req[source]?.[name] ?? null;
}

async function authorizeOwnedResource({
  req,
  res,
  next,
  resourceName,
  resourceId,
  loadResource,
  ownPermission,
  anyPermission,
}) {
  try {
    if (!UUID_PATTERN.test(String(resourceId || ''))) {
      return res.status(400).json({ success: false, message: `Invalid ${resourceName} ID` });
    }

    const resource = await loadResource(resourceId);

    if (!resource) {
      return res.status(404).json({ success: false, message: `${resourceName} not found` });
    }

    const authorization = req.authorization
      || await loadAuthorization(req.user.sub);
    const ownsResource = resource.owner_id === req.user.sub;
    const canAccessAny = anyPermission
      ? hasPermission(authorization, anyPermission)
      : false;
    const canAccessOwn = ownsResource
      && hasPermission(authorization, ownPermission);

    if (!authorization.isOwner && !canAccessAny && !canAccessOwn) {
      return res.status(403).json({
        success: false,
        message: `You cannot access this ${resourceName.toLowerCase()}`,
      });
    }

    req.authorization = authorization;
    req.authorizedResource = resource;
    req.resourceAccess = {
      isOwner: ownsResource,
      canAccessAny: authorization.isOwner || canAccessAny,
    };

    return next();
  } catch (error) {
    return next(error);
  }
}

async function loadVideo(videoId) {
  const { rows } = await writePool.query(
    `SELECT id, uploaded_by AS owner_id, visibility FROM videos WHERE id = $1 LIMIT 1`,
    [videoId],
  );
  return rows[0] || null;
}

async function loadPlaylist(playlistId) {
  const { rows } = await writePool.query(
    `SELECT id, created_by AS owner_id, status FROM playlists WHERE id = $1 LIMIT 1`,
    [playlistId],
  );
  return rows[0] || null;
}

async function loadLiveStream(liveStreamId) {
  const { rows } = await writePool.query(
    'SELECT id, user_id AS owner_id FROM public.live_streams WHERE id = $1 LIMIT 1',
    [liveStreamId],
  );
  return rows[0] || null;
}

async function loadComment(commentId) {
  const { rows } = await writePool.query(
    `
      SELECT id, user_id AS owner_id, is_deleted
      FROM video_comments
      WHERE id = $1 AND is_deleted = false
      LIMIT 1
    `,
    [commentId],
  );
  return rows[0] || null;
}

async function loadPostComment(commentId) {
  const { rows } = await writePool.query(
    `SELECT id, user_id AS owner_id, is_deleted
     FROM public.post_comments WHERE id = $1 AND is_deleted = false LIMIT 1`,
    [commentId],
  );
  return rows[0] || null;
}

function ownedResourceMiddleware({
  resourceName,
  idSource = 'params',
  idParameter,
  loadResource,
  ownPermission,
  anyPermission = null,
}) {
  return function configureOwnedResource(req, res, next) {
    return authorizeOwnedResource({
      req,
      res,
      next,
      resourceName,
      resourceId: readRequestId(req, idSource, idParameter),
      loadResource,
      ownPermission,
      anyPermission,
    });
  };
}

export function requireVideoAccess({
  ownPermission,
  anyPermission,
  idSource = 'params',
  idParameter = 'videoId',
}) {
  return ownedResourceMiddleware({
    resourceName: 'Video',
    idSource,
    idParameter,
    loadResource: loadVideo,
    ownPermission,
    anyPermission,
  });
}

export function requirePlaylistAccess({ ownPermission, anyPermission }) {
  return ownedResourceMiddleware({
    resourceName: 'Playlist',
    idParameter: 'playlistId',
    loadResource: loadPlaylist,
    ownPermission,
    anyPermission,
  });
}

export function requireLiveStreamAccess({ ownPermission, anyPermission }) {
  return ownedResourceMiddleware({
    resourceName: 'Live stream',
    idParameter: 'liveStreamId',
    loadResource: loadLiveStream,
    ownPermission,
    anyPermission,
  });
}

export function requireCommentAccess({ ownPermission, anyPermission = null }) {
  return ownedResourceMiddleware({
    resourceName: 'Comment',
    idParameter: 'id',
    loadResource: loadComment,
    ownPermission,
    anyPermission,
  });
}

export function requirePostCommentAccess({ ownPermission, anyPermission = null }) {
  return ownedResourceMiddleware({
    resourceName: 'Post comment',
    idParameter: 'id',
    loadResource: loadPostComment,
    ownPermission,
    anyPermission,
  });
}
