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
      return res.status(400).json({ message: `Invalid ${resourceName} ID` });
    }

    const resource = await loadResource(resourceId);

    if (!resource) {
      return res.status(404).json({ message: `${resourceName} not found` });
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

async function loadQuiz(quizId) {
  const { rows } = await writePool.query(
    `SELECT id, created_by AS owner_id, is_active FROM quizzes WHERE id = $1 LIMIT 1`,
    [quizId],
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

const quizChildLoaders = {
  question: async (questionId) => {
    const { rows } = await writePool.query(
      `
        SELECT qq.id, q.id AS quiz_id, q.created_by AS owner_id
        FROM quiz_questions qq
        JOIN quizzes q ON q.id = qq.quiz_id
        WHERE qq.id = $1
        LIMIT 1
      `,
      [questionId],
    );
    return rows[0] || null;
  },
  rule: async (ruleId) => {
    const { rows } = await writePool.query(
      `
        SELECT qar.id, q.id AS quiz_id, q.created_by AS owner_id
        FROM quiz_access_rules qar
        JOIN quizzes q ON q.id = qar.quiz_id
        WHERE qar.id = $1
        LIMIT 1
      `,
      [ruleId],
    );
    return rows[0] || null;
  },
  questionSource: async (sourceId) => {
    const { rows } = await writePool.query(
      `
        SELECT qqs.id, q.id AS quiz_id, q.created_by AS owner_id
        FROM quiz_question_sources qqs
        JOIN quizzes q ON q.id = qqs.quiz_id
        WHERE qqs.id = $1
        LIMIT 1
      `,
      [sourceId],
    );
    return rows[0] || null;
  },
};

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

export function requireQuizAccess({ ownPermission, anyPermission }) {
  return ownedResourceMiddleware({
    resourceName: 'Quiz',
    idParameter: 'quizId',
    loadResource: loadQuiz,
    ownPermission,
    anyPermission,
  });
}

export function requireQuizChildAccess({
  childType,
  idParameter,
  ownPermission,
  anyPermission,
}) {
  const loadResource = quizChildLoaders[childType];
  if (!loadResource) throw new Error(`Unsupported quiz child type: ${childType}`);

  return ownedResourceMiddleware({
    resourceName: 'Quiz resource',
    idParameter,
    loadResource,
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
