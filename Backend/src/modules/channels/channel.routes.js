import { listChannelLivestreams } from '../livestreams/livestream.controller.js';
import express from 'express';
import { optionalAuth } from '../../middleware/auth.js';
import * as channelController from './channel.controller.js';

const router = express.Router();

router.get('/:id/livestreams', optionalAuth, listChannelLivestreams);
router.get('/:id/videos', optionalAuth, channelController.getChannelVideos);
router.get('/:id/playlists', optionalAuth, channelController.getChannelPlaylists);
router.get('/:id', optionalAuth, channelController.getChannelDetailsById);


export default router;