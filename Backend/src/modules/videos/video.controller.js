import { initiateUploadInternal } from './handlers/initiateUpload.js';
import { generateChaptersInternal } from './handlers/generateChapters.js';
import { muxWebhookInternal } from './handlers/muxWebhook.js';
import { getTrendingInternal } from './handlers/getTrending.js';
import { getCategoriesInternal } from './handlers/getCategories.js';
import { getUserHistoryInternal } from './handlers/getUserHistory.js';
import { getContinueWatchingInternal } from './handlers/getContinueWatching.js';
import { getLikedVideosInternal } from './handlers/getLikedVideos.js';
import { getCommentsInternal } from './handlers/getComments.js';
import { getClientIp } from './helpers/videoRoutes.shared.js';
import { logEvent } from '../../common/logger.js';
import { heartbeatWatchDurationInternal } from './handlers/heartbeatWatchDuration.js';
import { searchVideosInternal } from './handlers/searchVideos.js';
import { getPersonalizedRecommendationsInternal } from './handlers/getPersonalizedRecommendations.js';
import { updateWatchProgressInternal } from './handlers/updateWatchProgress.js';
import { setVideoReactionInternal } from './handlers/setVideoReaction.js';
import { getRecommendedVideosInternal } from './handlers/getRecommendedVideos.js';
import { getVideoByIdInternal } from './handlers/getVideoById.js';
import { incrementViewCountInternal } from './handlers/incrementViewCount.js';

export async function handleHeartbeat(req, res) {
  try {
    const userId = req.user?.sub || null;

    const { view_id, seq, is_playing = false } = req.body;

    // Koristi isti IP izvor kao incrementViewCount, da anonimni hash bude isti.
    const ip = getClientIp(req);

    // Origin / Referer (browser šalje origin za CORS/fetch, ali nekad ga nema)
    const origin = req.headers.origin || null;
    const referer = req.headers.referer || null;

    // User-Agent
    const userAgent = req.headers['user-agent'] || '';

    // Korisno za debug: host, sec-fetch-site, accept-language...
    const host = req.headers.host || null;
    const secFetchSite = req.headers['sec-fetch-site'] || null;
    const secFetchMode = req.headers['sec-fetch-mode'] || null;

    logEvent('videos.heartbeat', {
      user_id: userId,
      view_id,
      seq,
      is_playing,
      origin,
      referer,
      ip,
      //user_agent: userAgent,
      host,
      sec_fetch_site: secFetchSite,
      sec_fetch_mode: secFetchMode,
      message: 'Updating View',
    });

    const updated = await heartbeatWatchDurationInternal(view_id, {
      seq,
      isPlaying: is_playing,
      userId,
      ip,
      userAgent,
    });

    if (!updated) {
      return res.status(404).json({ success: false, message: 'view_id not found' });
    }

    return res.json({
      success: true,
      message: 'OK',
    });
  } catch (err) {
    console.error('Heartbeat watch_duration failed:', err);
    return res.status(400).json({ success: false, message: err.message || 'Bad request' });
  }
}

export async function handleSearchVideos(req, res) {
  try {
    const userId = req.user?.sub || null;
    const {
      q, // search query
      category,
      tags, // comma-separated
      person,
      sort = 'relevance',
      limit = 20,
      page = 1,
    } = req.query;

    const searchParams = {
      query: q,
      category,
      tags: tags ? tags.split(',').map((t) => t.trim()) : null,
      person: person,
      sortBy: sort,
      limit: Math.min(parseInt(limit), 100),
      offset: (parseInt(page) - 1) * parseInt(limit),
    };

    const results = await searchVideosInternal(searchParams, userId);

    res.json({
      videos: results.videos,
      pagination: {
        total: results.total,
        page: parseInt(page),
        limit: results.limit,
        totalPages: Math.ceil(results.total / results.limit),
      },
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ message: 'Search failed' });
  }
}

export async function handleGetRecommended(req, res) {
  try {
    const userId = req.user.sub;
    const { limit = 20, page = 1 } = req.query;

    const videos = await getPersonalizedRecommendationsInternal(userId, limit, page);

    if (!videos) {
      return res.status(404).json({ message: 'Video not found' });
    }

    res.json({
      videos: videos,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    console.error('Get video error:', error);
    res.status(500).json({ message: 'Failed to fetch video' });
  }
}

export async function handleUpdateProgress(req, res) {
  try {
    const { progressSeconds } = req.body;
    if (typeof progressSeconds !== 'number' || progressSeconds < 0) {
      return res.status(400).json({
        message: 'Invalid progress value',
      });
    }

    await updateWatchProgressInternal(req.params.id, req.user.sub, progressSeconds);

    res.json({
      success: true,
      message: 'Progress updated',
    });
  } catch (error) {
    console.error('Progress update error:', error);
    res.status(500).json({ message: 'Failed to update progress' });
  }
}

export async function handleLikeVideo(req, res) {
  try {
    const result = await setVideoReactionInternal(req.params.id, req.user.sub, 'like');
    res.json({ success: true, status: result.status });
  } catch (e) {
    res.status(500).json({ message: 'Failed to set like' });
  }
}

export async function handleDislikeVideo(req, res) {
  try {
    const result = await setVideoReactionInternal(req.params.id, req.user.sub, 'dislike');
    res.json({ success: true, status: result.status });
  } catch (e) {
    res.status(500).json({ message: 'Failed to set dislike' });
  }
}

export async function handleGetSimilarVideos(req, res) {
  try {
    const userId = req.user?.sub || null;
    const videoId = req.params.id;
    const { limit = 20, page = 1 } = req.query;

    const videos = await getRecommendedVideosInternal(videoId, userId, limit, page);

    if (!videos) {
      return res.status(404).json({ message: 'Video not found' });
    }

    res.json({
      videos: videos,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    console.error('Get video error:', error);
    res.status(500).json({ message: 'Failed to fetch video' });
  }
}

export async function handleGetVideoById(req, res) {
  try {
    const userId = req.user?.sub || null;
    let video = await getVideoByIdInternal(req.params.id, userId);

    if (!video) {
      logEvent('videos.get_failed', { user_id: userId, message: 'No video' });
      return res.status(404).json({ message: 'Video not found' });
    }
    let view = null;
    try {
      view = await incrementViewCountInternal(req.params.id, {
        userId,
        ip: getClientIp(req),
        userAgent: req.get('user-agent') || '',
      });
    } catch (e) {
      console.warn('View tracking failed (ignored):', e);
    }
    video.view = view;
    logEvent('videos.get_success', {
      user_id: userId,
      video: { id: video.id, title: video.title },
      view: view,
      message: 'Successfull',
    });
    return res.json(video);
  } catch (error) {
    console.error('Get video error:', error);
    res.status(500).json({ message: 'Failed to fetch video' });
  }
}
export async function handleInitiateUpload(req, res) {
  try {
    const result = await initiateUploadInternal({ body: req.body }, req.user?.sub || null);
    return res.status(200).json(result);
  } catch (error) {
    return res
      .status(error.status || 500)
      .json(error.body || { message: error.message || 'Internal server error' });
  }
}

export async function handleGenerateChapters(req, res) {
  try {
    const result = await generateChaptersInternal({ body: req.body });
    return res.status(200).json(result);
  } catch (error) {
    return res
      .status(error.status || 500)
      .json(error.body || { message: error.message || 'Internal server error' });
  }
}

export async function handleMuxWebhook(req, res) {
  try {
    const result = await muxWebhookInternal({ body: req.body, headers: req.headers });
    return res.status(200).json(result);
  } catch (error) {
    return res
      .status(error.status || 500)
      .json(error.body || { message: error.message || 'Internal server error' });
  }
}

export async function handleGetTrending(req, res) {
  try {
    const result = await getTrendingInternal({ query: req.query }, req.user?.sub || null);
    return res.status(200).json(result);
  } catch (error) {
    return res
      .status(error.status || 500)
      .json(error.body || { message: error.message || 'Internal server error' });
  }
}

export async function handleGetCategories(req, res) {
  try {
    const result = await getCategoriesInternal({ query: req.query });
    return res.status(200).json(result);
  } catch (error) {
    return res
      .status(error.status || 500)
      .json(error.body || { message: error.message || 'Internal server error' });
  }
}

export async function handleGetUserHistory(req, res) {
  try {
    const result = await getUserHistoryInternal({ query: req.query }, req.user?.sub || null);
    return res.status(200).json(result);
  } catch (error) {
    return res
      .status(error.status || 500)
      .json(error.body || { message: error.message || 'Internal server error' });
  }
}

export async function handleGetContinueWatching(req, res) {
  try {
    const result = await getContinueWatchingInternal({ query: req.query }, req.user?.sub || null);
    return res.status(200).json(result);
  } catch (error) {
    return res
      .status(error.status || 500)
      .json(error.body || { message: error.message || 'Internal server error' });
  }
}

export async function handleGetLikedVideos(req, res) {
  try {
    const result = await getLikedVideosInternal({ query: req.query }, req.user?.sub || null);
    return res.status(200).json(result);
  } catch (error) {
    return res
      .status(error.status || 500)
      .json(error.body || { message: error.message || 'Internal server error' });
  }
}

export async function handleGetComments(req, res) {
  try {
    const result = await getCommentsInternal(
      { params: req.params, query: req.query },
      req.user?.sub || null,
    );
    return res.status(200).json(result);
  } catch (error) {
    return res
      .status(error.status || 500)
      .json(error.body || { message: error.message || 'Internal server error' });
  }
}
