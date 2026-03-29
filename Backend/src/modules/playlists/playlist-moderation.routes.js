import express from 'express';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';
import {
    handleGetMyPlaylists,
    handlePatchPlaylistDetails,
    playlistThumbnailUploadMiddleware,
    handlePlaylistThumbnailUpload,
    addVideoToPlaylist,
    removeVideoFromPlaylist,
    movePlaylistItem,
//    reorderPlaylistItems,
    handleCreatePlaylist,
    handleDeletePlaylist,
} from './playlist-moderation.service.js';

const router = express.Router();

router.get('/my/playlists', requireAuth, requireAdmin,handleGetMyPlaylists);
router.patch("/playlist-details/:playlistId", requireAuth, requireAdmin, handlePatchPlaylistDetails);
router.post("/:playlistId/thumbnail",requireAuth,requireAdmin,playlistThumbnailUploadMiddleware,handlePlaylistThumbnailUpload);

// playlists.routes.js
router.post("/:playlistId/items", requireAuth, requireAdmin, addVideoToPlaylist);
router.delete("/:playlistId/items/:videoId", requireAuth, requireAdmin, removeVideoFromPlaylist);
router.patch("/:playlistId/items/move", requireAuth, requireAdmin, movePlaylistItem);
// router.patch("/:playlistId/items/reorder", requireAuth, requireAdmin, reorderPlaylistItems);
router.post("/playlist/create", requireAuth, requireAdmin, handleCreatePlaylist);
router.delete("/playlist/:playlistId", requireAuth, requireAdmin, handleDeletePlaylist);


export default router;
