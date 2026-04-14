import express from 'express';
import { optionalAuth } from '../../middleware/auth.js';
import getChannelDetailsById from './operations/getChannelDetailsById.js'
import getChannelVideos from './operations/getChannelVideos.js';

const router = express.Router();

router.get('/:id/videos', optionalAuth, getChannelVideos);
router.get('/:id', optionalAuth, getChannelDetailsById);

export default router;