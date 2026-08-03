import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../authorization/authorization.middleware.js';
import { Permissions } from '../authorization/permission.constants.js';
import { requireVideoAccess } from '../authorization/resource-authorization.js';
import * as analyticsController from './analytics.controller.js'

const router = express.Router();

const requirePlatformAnalytics = requirePermission(Permissions.ANALYTICS_PLATFORM_READ);
const requireOwnChannelAnalytics = requirePermission(Permissions.ANALYTICS_CHANNEL_OWN_READ);
const requireVideoAnalytics = requireVideoAccess({
  ownPermission: Permissions.ANALYTICS_VIDEO_OWN_READ,
  anyPermission: Permissions.ANALYTICS_VIDEO_ANY_READ,
});

router.get('/platform/overview', requireAuth, requirePlatformAnalytics, analyticsController.getPlatformOverviewAnalytics);
router.get('/platform/average-engagement-per-video', requireAuth, requirePlatformAnalytics, analyticsController.getPlatformAverageEngagementPerVideo);
router.get('/platform/top-viewed-videos', requireAuth, requirePlatformAnalytics, analyticsController.getPlatformTopViewedVideos);
router.get('/platform/top-viewed-playlists', requireAuth, requirePlatformAnalytics, analyticsController.getPlatformTopViewedPlaylists);
router.get('/platform/device-split', requireAuth, requirePlatformAnalytics, analyticsController.getPlatformDeviceSplit);
router.get('/platform/operating-system-split', requireAuth, requirePlatformAnalytics, analyticsController.getPlatformOperatingSystemSplit);
router.get('/platform/geographic-breakdown', requireAuth, requirePlatformAnalytics, analyticsController.getPlatformGeographicBreakdown);
router.get('/platform/views-over-time', requireAuth, requirePlatformAnalytics, analyticsController.getPlatformViewsOverTime);
router.get('/platform/watch-time-over-time', requireAuth, requirePlatformAnalytics, analyticsController.getPlatformWatchTimeOverTime);
router.get('/platform/signups-over-time', requireAuth, requirePlatformAnalytics, analyticsController.getPlatformSignupsOverTime);
router.get('/platform/active-users-over-time', requireAuth, requirePlatformAnalytics, analyticsController.getPlatformActiveUsersOverTime);

router.get('/channel/overview', requireAuth, requireOwnChannelAnalytics, analyticsController.getChannelOverviewAnalytics);
router.get('/channel/device-split', requireAuth, requireOwnChannelAnalytics, analyticsController.getChannelDeviceSplit);
router.get('/channel/operating-system-split', requireAuth, requireOwnChannelAnalytics, analyticsController.getChannelOperatingSystemSplit);
router.get('/channel/geographic-breakdown', requireAuth, requireOwnChannelAnalytics, analyticsController.getChannelGeographicBreakdown);
router.get('/channel/views-over-time', requireAuth, requireOwnChannelAnalytics, analyticsController.getChannelViewsOverTime);
router.get('/channel/watch-time-over-time', requireAuth, requireOwnChannelAnalytics, analyticsController.getChannelWatchTimeOverTime);
router.get('/channel/average-engagement-per-video', requireAuth, requireOwnChannelAnalytics, analyticsController.getChannelAverageEngagementPerVideo);

router.get('/:videoId/overview', requireAuth, requireVideoAnalytics, analyticsController.getOverviewVideoAnalytics);
router.get('/:videoId/device-split', requireAuth, requireVideoAnalytics, analyticsController.getDeviceSplit);
router.get('/:videoId/operating-system-split', requireAuth, requireVideoAnalytics, analyticsController.getOperatingSystemSplit);
router.get('/:videoId/geographic-breakdown', requireAuth, requireVideoAnalytics, analyticsController.getGeographicBreakdown);
router.get('/:videoId/views-over-time', requireAuth, requireVideoAnalytics, analyticsController.getViewsOverTime);
router.get('/:videoId/watch-time-over-time', requireAuth, requireVideoAnalytics, analyticsController.getWatchTimeOverTime);
router.get('/:videoId/completion-buckets', requireAuth, requireVideoAnalytics, analyticsController.getCompletionBuckets);
router.get('/:videoId/engagement', requireAuth, requireVideoAnalytics, analyticsController.getEngagement);

export default router;
