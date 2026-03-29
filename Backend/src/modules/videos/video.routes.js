import express from 'express';
import { requireAuth, requireAdmin, optionalAuth } from '../../middleware/auth.js';
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
} from './video-route.service.js';

const router = express.Router();

router.post('/upload/initiate', requireAuth, requireAdmin, handleInitiateUpload);
router.post('/heartbeat', requireAuth, handleHeartbeat);
router.post('/generate-chapters', requireAuth, requireAdmin, handleGenerateChapters);
router.post('/webhook/mux', handleMuxWebhook);
router.get('/search', requireAuth, handleSearchVideos);
router.get('/trending', optionalAuth, handleGetTrending);
router.get('/categories', requireAuth, handleGetCategories);
router.get('/user/history', requireAuth, handleGetUserHistory);
router.get('/user/continue', requireAuth, handleGetContinueWatching);
router.get('/user/liked', requireAuth, handleGetLikedVideos);
router.get('/user/recommended', requireAuth, handleGetRecommended);
router.post('/:id/progress', requireAuth, handleUpdateProgress);
router.post('/:id/like', requireAuth, handleLikeVideo);
router.post('/:id/dislike', requireAuth, handleDislikeVideo);
router.get('/:id/similar', requireAuth, handleGetSimilarVideos);
router.get('/:id/comments', requireAuth, handleGetComments);
router.get('/:id', requireAuth, handleGetVideoById);

export default router;
