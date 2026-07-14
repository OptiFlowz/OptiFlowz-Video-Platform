import express from 'express';
import { optionalAuth, requireAdmin , requireAuth} from '../../middleware/auth.js';
import * as analyticsController from './analytics.controller.js'

const router = express.Router();

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

export default router;
