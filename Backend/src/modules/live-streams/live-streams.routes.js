import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { createLiveStream, getStreamingDetails, deleteLiveStream } from './live-streams.controller.js';

const router = express.Router();

router.post('/', requireAuth, createLiveStream);
router.get('/:liveStreamId/streaming-details', requireAuth, getStreamingDetails);
router.delete('/:liveStreamId', requireAuth, deleteLiveStream);

export default router;
