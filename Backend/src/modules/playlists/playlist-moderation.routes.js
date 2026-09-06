import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../authorization/authorization.middleware.js';
import { Permissions } from '../authorization/permission.constants.js';
import { requirePlaylistAccess } from '../authorization/resource-authorization.js';
import {
  handleGetMyPlaylists,
  handlePatchPlaylistDetails,
  handlePlaylistThumbnailUpload,
  addVideoToPlaylist,
  removeVideoFromPlaylist,
  movePlaylistItem,
  handleCreatePlaylist,
  handleDeletePlaylist,
} from './playlist-moderation.controller.js';
import { playlistThumbnailUploadMiddleware } from './playlist.middleware.js';

const router = express.Router();

const requirePlaylistUpdate = requirePlaylistAccess({
  ownPermission: Permissions.PLAYLISTS_UPDATE_OWN,
  anyPermission: Permissions.PLAYLISTS_UPDATE_ANY,
});
const requirePlaylistDelete = requirePlaylistAccess({
  ownPermission: Permissions.PLAYLISTS_DELETE_OWN,
  anyPermission: Permissions.PLAYLISTS_DELETE_ANY,
});

router.get(
  '/my/playlists',
  requireAuth,
  requirePermission(Permissions.PLAYLISTS_UPDATE_OWN),
  handleGetMyPlaylists,
);
router.patch(
  '/playlist-details/:playlistId',
  requireAuth,
  requirePlaylistUpdate,
  handlePatchPlaylistDetails,
);
router.post(
  '/:playlistId/thumbnail',
  requireAuth,
  requirePlaylistUpdate,
  playlistThumbnailUploadMiddleware,
  handlePlaylistThumbnailUpload,
);

// playlists.routes.js
router.post('/:playlistId/items', requireAuth, requirePlaylistUpdate, addVideoToPlaylist);
router.delete(
  '/:playlistId/items/:videoId',
  requireAuth,
  requirePlaylistUpdate,
  removeVideoFromPlaylist,
);
router.patch('/:playlistId/items/move', requireAuth, requirePlaylistUpdate, movePlaylistItem);
// router.patch("/:playlistId/items/reorder", requireAuth, requirePlaylistUpdate, reorderPlaylistItems);
router.post(
  '/playlist/create',
  requireAuth,
  requirePermission(Permissions.PLAYLISTS_CREATE),
  handleCreatePlaylist,
);
router.delete('/playlist/:playlistId', requireAuth, requirePlaylistDelete, handleDeletePlaylist);

export default router;
