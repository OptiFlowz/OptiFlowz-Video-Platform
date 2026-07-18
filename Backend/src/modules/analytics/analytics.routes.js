import express from 'express';
import { optionalAuth, requireAdmin , requireAuth} from '../../middleware/auth.js';
import * as analyticsController from './analytics.controller.js'

const router = express.Router();

router.get(
  '/channel/overview',
  requireAuth,
  requireAdmin,
  analyticsController.getChannelOverviewAnalytics,
);
router.get(
  '/channel/device-split',
  requireAuth,
  requireAdmin,
  analyticsController.getChannelDeviceSplit,
);
router.get(
  '/channel/operating-system-split',
  requireAuth,
  requireAdmin,
  analyticsController.getChannelOperatingSystemSplit,
);
router.get(
  '/channel/geographic-breakdown',
  requireAuth,
  requireAdmin,
  analyticsController.getChannelGeographicBreakdown,
);
router.get(
  '/channel/views-over-time',
  requireAuth,
  requireAdmin,
  analyticsController.getChannelViewsOverTime,
);
router.get(
  '/channel/watch-time-over-time',
  requireAuth,
  requireAdmin,
  analyticsController.getChannelWatchTimeOverTime,
);
router.get('/:videoId/overview', requireAuth, requireAdmin, analyticsController.getOverviewVideoAnalytics);
router.get('/:videoId/device-split', requireAuth, requireAdmin, analyticsController.getDeviceSplit);
router.get(
  '/:videoId/operating-system-split',
  requireAuth,
  requireAdmin,
  analyticsController.getOperatingSystemSplit,
);
router.get(
  '/:videoId/geographic-breakdown',
  requireAuth,
  requireAdmin,
  analyticsController.getGeographicBreakdown,
);
router.get(
  '/:videoId/views-over-time',
  requireAuth,
  requireAdmin,
  analyticsController.getViewsOverTime,
);
router.get(
  '/:videoId/watch-time-over-time',
  requireAuth,
  requireAdmin,
  analyticsController.getWatchTimeOverTime,
);
router.get(
  '/:videoId/completion-buckets',
  requireAuth,
  requireAdmin,
  analyticsController.getCompletionBuckets,
);
router.get(
  '/:videoId/engagement',
  requireAuth,
  requireAdmin,
  analyticsController.getEngagement,
);

export default router;
