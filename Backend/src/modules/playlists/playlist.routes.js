import express from 'express';
import { requireAuth, optionalAuth } from '../../middleware/auth.js';
import { requirePermission } from '../authorization/authorization.middleware.js';
import { Permissions } from '../authorization/permission.constants.js';
import * as playlistController from './playlist.controller.js';

const router = express.Router();

router.get('/search', optionalAuth, playlistController.searchPlaylists);

router.get('/featured', optionalAuth, playlistController.getFeaturedPlaylists);

router.post(
  '/:id/save',
  requireAuth,
  requirePermission(Permissions.PLAYLISTS_SAVE),
  playlistController.savePlaylist,
);

router.get(
  '/user/saved',
  requireAuth,
  requirePermission(Permissions.PLAYLISTS_LIBRARY_READ),
  playlistController.getSavedPlaylists,
);

router.get('/:id/videos', optionalAuth, playlistController.getPlaylistVideos);
router.get('/:id', optionalAuth, playlistController.getPlaylistById);

export default router;
