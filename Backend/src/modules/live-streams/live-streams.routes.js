import express from 'express';
import { requireAuth, optionalAuth } from '../../middleware/auth.js';
import { requirePermission } from '../authorization/authorization.middleware.js';
import { Permissions } from '../authorization/permission.constants.js';
import { requireLiveStreamAccess } from '../authorization/resource-authorization.js';
import { createLiveStream, getStreamingDetails, deleteLiveStream, uploadLiveThumbnail, getMyLiveStreams, updateLiveDetails, getUserLiveCards, getLivePlayback, getLiveDetails } from './live-streams.controller.js';
import { liveThumbnailUploadMiddleware } from './live-streams.middleware.js';

const router = express.Router();

const requireLiveUpdate = requireLiveStreamAccess({
  ownPermission: Permissions.LIVE_STREAMS_UPDATE_OWN,
  anyPermission: Permissions.LIVE_STREAMS_UPDATE_ANY,
});
const requireLiveDelete = requireLiveStreamAccess({
  ownPermission: Permissions.LIVE_STREAMS_DELETE_OWN,
  anyPermission: Permissions.LIVE_STREAMS_DELETE_ANY,
});
const requireLiveStreaming = requireLiveStreamAccess({
  ownPermission: Permissions.LIVE_STREAMS_STREAM_OWN,
  anyPermission: Permissions.LIVE_STREAMS_STREAM_ANY,
});

router.post('/', requireAuth, requirePermission(Permissions.LIVE_STREAMS_CREATE), createLiveStream);
router.get('/my/lives', requireAuth, requirePermission(Permissions.LIVE_STREAMS_UPDATE_OWN), getMyLiveStreams);
router.get('/users/:userId/cards', optionalAuth, getUserLiveCards);
router.patch('/:liveStreamId', requireAuth, requireLiveUpdate, updateLiveDetails);
router.post('/:liveStreamId/thumbnail', requireAuth, requireLiveUpdate, liveThumbnailUploadMiddleware, uploadLiveThumbnail);
router.get('/:liveStreamId/streaming-details', requireAuth, requireLiveStreaming, getStreamingDetails);
router.post('/:liveStreamId/playback', requireAuth, getLivePlayback);
router.get('/:liveStreamId', requireAuth, getLiveDetails);
router.delete('/:liveStreamId', requireAuth, requireLiveDelete, deleteLiveStream);

export default router;
