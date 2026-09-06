import express from 'express';
import { requireAuth, optionalAuth } from '../../middleware/auth.js';
import { requirePermission } from '../authorization/authorization.middleware.js';
import { Permissions } from '../authorization/permission.constants.js';
import { requireVideoAccess } from '../authorization/resource-authorization.js';
import {
  handleInitiateUpload,
  handleHeartbeat,
  handleGenerateChapters,
  handleMuxWebhook,
  handleSearchVideos,
  handleGetTrending,
  handleGetCategories,
  handleGetUserHistory,
  handleGetContinueWatching,
  handleGetLikedVideos,
  handleGetRecommended,
  handleUpdateProgress,
  handleLikeVideo,
  handleDislikeVideo,
  handleGetSimilarVideos,
  handleGetVideoById,
  handleGetComments,
} from './video.controller.js';

const router = express.Router();

router.post(
  '/upload/initiate',
  requireAuth,
  requirePermission(Permissions.VIDEOS_CREATE),
  handleInitiateUpload,
);
router.post('/heartbeat', optionalAuth, handleHeartbeat);
router.post(
  '/generate-chapters',
  requireAuth,
  requireVideoAccess({
    ownPermission: Permissions.VIDEOS_UPDATE_OWN,
    anyPermission: Permissions.VIDEOS_UPDATE_ANY,
    idSource: 'body',
    idParameter: 'videoId',
  }),
  handleGenerateChapters,
);
router.post('/webhook/mux', handleMuxWebhook);
router.get('/search', optionalAuth, handleSearchVideos);
router.get('/trending', optionalAuth, handleGetTrending);
router.get(
  '/categories',
  requireAuth,
  requirePermission(Permissions.VIDEOS_LIBRARY_READ),
  handleGetCategories,
);
router.get(
  '/user/history',
  requireAuth,
  requirePermission(Permissions.VIDEOS_LIBRARY_READ),
  handleGetUserHistory,
);
router.get(
  '/user/continue',
  requireAuth,
  requirePermission(Permissions.VIDEOS_LIBRARY_READ),
  handleGetContinueWatching,
);
router.get(
  '/user/liked',
  requireAuth,
  requirePermission(Permissions.VIDEOS_LIBRARY_READ),
  handleGetLikedVideos,
);
router.get(
  '/user/recommended',
  requireAuth,
  requirePermission(Permissions.VIDEOS_LIBRARY_READ),
  handleGetRecommended,
);
router.post(
  '/:id/progress',
  requireAuth,
  requirePermission(Permissions.VIDEOS_PROGRESS_UPDATE),
  handleUpdateProgress,
);
router.post('/:id/like', requireAuth, requirePermission(Permissions.VIDEOS_REACT), handleLikeVideo);
router.post(
  '/:id/dislike',
  requireAuth,
  requirePermission(Permissions.VIDEOS_REACT),
  handleDislikeVideo,
);
router.get('/:id/similar', optionalAuth, handleGetSimilarVideos);
router.get('/:id/comments', optionalAuth, handleGetComments);
router.get('/:id', optionalAuth, handleGetVideoById);

export default router;
