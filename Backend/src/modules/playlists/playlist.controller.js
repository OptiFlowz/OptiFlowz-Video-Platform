import { logEvent } from '../../common/logger.js';
import { searchPlaylistsInternal } from './handlers/searchPlaylists.js';
import { getFeaturedPlaylistsInternal } from './handlers/getFeaturedPlaylists.js';
import { togglePlaylistSaveInternal } from './handlers/savePlaylist.js';
import { getSavedPlaylistsInternal } from './handlers/getSavedPlaylists.js';
import { getPlaylistByIdInternal } from './handlers/getPlaylistById.js';
import { getPlaylistVideosInternal } from './handlers/getPlaylistVideos.js';
import { playlistIncrementViewCountInternal } from './handlers/playlistIncrementViewCount.js';
import { getClientIp } from '../../common/ipUitl.js';
import { sendSuccess, sendError } from '../../common/response.js';

export async function getPlaylistById(req, res) {
  try {
    const playlist = await getPlaylistByIdInternal(req.params, req.user?.sub || null);

    if (!playlist) {
      return sendError(res, 'Playlist not found', 404);
    }

    const view = await playlistIncrementViewCountInternal({
      playlistId: req.params.id,
      userId: req.user?.sub || null,
      ip: getClientIp(req),
      userAgent: req.get('user-agent') || '',
    });

    return sendSuccess(res, { playlist, view });
  } catch (error) {
    console.log('Error fetching playlist by id:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function getPlaylistVideos(req, res) {
  try {
    const result = await getPlaylistVideosInternal(
      { ...req.params, ...req.query },
      req.user?.sub || null,
    );
    return sendSuccess(res, result);
  } catch (error) {
    console.log('Error fetching playlist videos', error);
    return sendError(res, error.message, error.status || 500);
  }
}
export async function searchPlaylists(req, res) {
  try {
    const { q, tags, sort = 'relevance', limit = 20, page = 1 } = req.query;

    const searchParams = {
      query: q,
      tags: tags
        ? tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
        : null,
      sortBy: sort,
      limit: Math.min(parseInt(limit, 10), 100),
      offset: (parseInt(page, 10) - 1) * parseInt(limit, 10),
    };

    const results = await searchPlaylistsInternal(searchParams);

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
}

export async function getFeaturedPlaylists(req, res) {
  try {
    logEvent('playlist.featured', { user_id: req.user?.sub, message: 'Visited home page' });
    const result = await getFeaturedPlaylistsInternal();
    return res.json(result);
  } catch (err) {
    console.error('GET /playlists/featured error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

export async function savePlaylist(req, res) {
  try {
    const userId = req.user?.sub || null;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const { id } = req.params;
    if (!id) return res.status(400).json({ message: 'id is required' });

    const result = await togglePlaylistSaveInternal(id, userId);

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
}

export async function getSavedPlaylists(req, res) {
  try {
    const userId = req.user?.sub || null;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const result = await getSavedPlaylistsInternal(userId, req.query);
    return res.json(result);
  } catch (err) {
    console.error('GET /playlists/saved error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}
