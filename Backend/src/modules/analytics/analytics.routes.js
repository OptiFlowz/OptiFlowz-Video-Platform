import express from 'express';
import { optionalAuth, requireAdmin , requireAuth} from '../../middleware/auth.js';
import * as analyticsController from './analytics.controller.js'

const router = express.Router();

router.get(':videoId/overview',requireAuth,requireAdmin);

export default router;