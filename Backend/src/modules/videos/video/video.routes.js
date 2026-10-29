import express from 'express';
import { requireAuth, optionalAuth } from '../../../middleware/auth.js';
import { requirePermission } from '../../authorization/authorization.middleware.js';
import { Permissions } from '../../authorization/permission.constants.js';
import {
  handleInitiateUpload,
  handleHeartbeat,
  handleMuxWebhook,
  handleSearchVideos,
  handleSearchVideosVector,
  handleGetTrending,
  handleGetCategories,
  handleGetUserHistory,
  handleGetContinueWatching,
  handleGetLikedVideos,
  handleGetRecommended,
  handleGetPersonalizedRecommendationsVector,
  handleUpdateProgress,
  handleLikeVideo,
  handleDislikeVideo,
  handleGetSimilarVideos,
  handleGetSimilarVideosVector,
  handleGetVideoById,
  handleGetVideoPlayback,
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
router.post('/webhook/mux', handleMuxWebhook);
router.get('/search', optionalAuth, handleSearchVideos);
router.get('/search/vector', optionalAuth, handleSearchVideosVector);
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
router.get(
  '/user/recommended/vector',
  requireAuth,
  requirePermission(Permissions.VIDEOS_LIBRARY_READ),
  handleGetPersonalizedRecommendationsVector,
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
router.get('/:id/similar/vector', optionalAuth, handleGetSimilarVideosVector);
router.post('/:id/playback', optionalAuth, handleGetVideoPlayback);
router.get('/:id/comments', optionalAuth, handleGetComments);
router.get('/:id', optionalAuth, handleGetVideoById);


// router.get('/:id/similar', requireAuth, handleGetSimilarVideos);
// router.get('/:id/similar/vector', requireAuth, handleGetSimilarVideosVector);
// router.post('/:id/playback', requireAuth, handleGetVideoPlayback);
// router.get('/:id/comments', requireAuth, handleGetComments);
// router.get('/:id', requireAuth, handleGetVideoById);

export default router;
