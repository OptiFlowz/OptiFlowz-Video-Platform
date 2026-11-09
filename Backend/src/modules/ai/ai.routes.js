import { Router } from 'express';
import { requireAiBearerToken } from './ai.middleware.js';
import { handleAiMcp } from './mcp/server.js';
import { searchVideos, getVideoChatSources } from './ai.controller.js';
import { getPersonById, searchPeople } from '../people/people.controller.js';
import { getPlaylistById, getPlaylistVideos, searchPlaylists } from '../playlists/playlists/playlist.controller.js';
import { handleGetVideoById } from '../videos/video/video.controller.js';

const router = Router();

router.use(requireAiBearerToken);
router.all('/mcp', handleAiMcp);
router.get('/people/search', searchPeople);
router.get('/people/:personId', getPersonById);
router.get('/playlists/search', searchPlaylists);
router.get('/playlists/:id/videos', getPlaylistVideos);
router.get('/playlists/:id', getPlaylistById);
router.get('/videos/search', searchVideos);
router.post('/videos/chat', getVideoChatSources);
router.get('/videos/:id', handleGetVideoById);

export default router;
