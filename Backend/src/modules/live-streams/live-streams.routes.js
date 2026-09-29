import express from 'express';
import { requireAuth, optionalAuth } from '../../middleware/auth.js';
import { createLiveStream, getStreamingDetails, deleteLiveStream, uploadLiveThumbnail, getMyLiveStreams, updateLiveDetails, getUserLiveCards, getLivePlayback, getLiveDetails } from './live-streams.controller.js';
import { liveThumbnailUploadMiddleware } from './live-streams.middleware.js';

const router = express.Router();

router.post('/', requireAuth, createLiveStream);
router.get('/my/lives', requireAuth, getMyLiveStreams);
router.get('/users/:userId/cards', optionalAuth, getUserLiveCards);
router.patch('/:liveStreamId', requireAuth, updateLiveDetails);
router.post('/:liveStreamId/thumbnail', requireAuth, liveThumbnailUploadMiddleware, uploadLiveThumbnail);
router.get('/:liveStreamId/streaming-details', requireAuth, getStreamingDetails);
router.post('/:liveStreamId/playback', requireAuth, getLivePlayback);
router.get('/:liveStreamId', requireAuth, getLiveDetails);
router.delete('/:liveStreamId', requireAuth, deleteLiveStream);

export default router;
