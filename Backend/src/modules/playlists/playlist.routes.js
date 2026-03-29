import express from 'express';
import * as playlistService from './playlist.service.js';
import { requireAuth , optionalAuth } from '../../middleware/auth.js';
import { logEvent } from '../../common/logger.js';

const router = express.Router();

router.get('/search', requireAuth, async (req, res) => {
  try {
    const { q, tags, sort = 'relevance', limit = 20, page = 1 } = req.query;

    const searchParams = {
      query: q,
      tags: tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : null,
      sortBy: sort,
      limit: Math.min(parseInt(limit, 10), 100),
      offset: (parseInt(page, 10) - 1) * parseInt(limit, 10),
    };

    const results = await playlistService.searchPlaylists(searchParams);

    res.json({
      playlists: results.playlists,
      pagination: {
        total: results.total,
        page: parseInt(page, 10),
        limit: results.limit,
        totalPages: Math.ceil(results.total / results.limit),
      },
    });
  } catch (error) {
    console.error('Playlist search error:', error);
    res.status(500).json({ message: 'Search failed' });
  }
});

router.get('/featured', optionalAuth, async (req, res) => {
  try {
    logEvent('playlist.featured', { user_id: req.user?.sub, message: 'Visited home page' });
    const result = await playlistService.getFeaturedPlaylists();
    return res.json(result);
  } catch (err) {
    console.error('GET /playlists/featured error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('/:id/save', requireAuth, async (req, res) => {
  try {
    const userId = req.user?.sub || null;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const { id } = req.params;
    if (!id) return res.status(400).json({ message: 'id is required' });

    const result = await playlistService.togglePlaylistSave(id, userId);

    return res.json({
      saved: result.saved,
      save_count: result.save_count,
    });
  } catch (err) {
    if (err?.message === 'PLAYLIST_NOT_FOUND') {
      return res.status(404).json({ message: 'Playlist not found' });
    }
    console.error('toggle-save error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

router.get('/user/saved', requireAuth, async (req, res) => {
  try {
    const userId = req.user?.sub || null;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const result = await playlistService.getSavedPlaylists(userId, req.query);
    return res.json(result);
  } catch (err) {
    console.error('GET /playlists/saved error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.user?.sub || null;
    let playlist = await playlistService.getPlaylistWithVideos(req.params.id, userId);

    if (!playlist) {
      return res.status(404).json({ message: 'Playlist not found' });
    }
    const view = await playlistService.incrementViewCount(req.params.id, {
      userId,
      ip: getClientIp(req),
      userAgent: req.get('user-agent') || '',
    });
    playlist.view = view;
    res.json(playlist);
    logEvent('playlist.get', { user_id: userId, playlist_id: playlist.id, message: 'Requested the playlist' });
  } catch (error) {
    console.error('Get playlist error:', error);
    res.status(500).json({ message: 'Failed to fetch playlist' });
  }
});

function getClientIp(req) {
  let ip = req.ip || '';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return ip;
}

export default router;
