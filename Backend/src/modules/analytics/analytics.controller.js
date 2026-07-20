import { sendSuccess, sendError } from '../../common/response.js';
import { getOverviewVideoAnalyticsInternal } from './handlers/video/getOverviewVideoAnalytics.js';
import { getDeviceSplitInternal } from './handlers/video/getDeviceSplit.js';
import { getOperatingSystemSplitInternal } from './handlers/video/getOperatingSystemSplit.js';
import { getGeographicBreakdownInternal } from './handlers/video/getGeographicBreakdown.js';
import { getViewsOverTimeInternal } from './handlers/video/getViewsOverTime.js';
import { getWatchTimeOverTimeInternal } from './handlers/video/getWatchTimeOverTime.js';
import { getCompletionBucketsInternal } from './handlers/video/getCompletionBuckets.js';
import { getEngagementInternal } from './handlers/video/getEngagement.js';
import { getChannelOverviewAnalyticsInternal } from './handlers/channel/getChannelOverviewAnalytics.js';
import { getChannelDeviceSplitInternal } from './handlers/channel/getChannelDeviceSplit.js';
import { getChannelOperatingSystemSplitInternal } from './handlers/channel/getChannelOperatingSystemSplit.js';
import { getChannelGeographicBreakdownInternal } from './handlers/channel/getChannelGeographicBreakdown.js';
import { getChannelViewsOverTimeInternal } from './handlers/channel/getChannelViewsOverTime.js';
import { getChannelWatchTimeOverTimeInternal } from './handlers/channel/getChannelWatchTimeOverTime.js';
import { getChannelAverageEngagementPerVideoInternal } from './handlers/channel/getChannelAverageEngagementPerVideo.js';
import { getPlatformOverviewAnalyticsInternal } from './handlers/platform/getPlatformOverviewAnalytics.js';
import { getPlatformAverageEngagementPerVideoInternal } from './handlers/platform/getPlatformAverageEngagementPerVideo.js';
import { getPlatformTopViewedVideosInternal } from './handlers/platform/getPlatformTopViewedVideos.js';
import { getPlatformTopViewedPlaylistsInternal } from './handlers/platform/getPlatformTopViewedPlaylists.js';
import { getPlatformDeviceSplitInternal } from './handlers/platform/getPlatformDeviceSplit.js';
import { getPlatformOperatingSystemSplitInternal } from './handlers/platform/getPlatformOperatingSystemSplit.js';
import { getPlatformGeographicBreakdownInternal } from './handlers/platform/getPlatformGeographicBreakdown.js';
import { getPlatformViewsOverTimeInternal } from './handlers/platform/getPlatformViewsOverTime.js';
import { getPlatformWatchTimeOverTimeInternal } from './handlers/platform/getPlatformWatchTimeOverTime.js';
import { getPlatformSignupsOverTimeInternal } from './handlers/platform/getPlatformSignupsOverTime.js';
import { getPlatformActiveUsersOverTimeInternal } from './handlers/platform/getPlatformActiveUsersOverTime.js';



export async function getOverviewVideoAnalytics(req, res) {
  try {
    const overview = await getOverviewVideoAnalyticsInternal({ ...req.params, ...req.body, ...req.query}, req.user?.sub || null);
    return sendSuccess(res, { overview }, 200);
  } catch (error) {
    console.error('Error creating video overview:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function getDeviceSplit(req, res) {
  try {
    const deviceSplit = await getDeviceSplitInternal(
      { ...req.params, ...req.body, ...req.query },
      req.user?.sub || null,
    );
    return sendSuccess(res, { deviceSplit }, 200);
  } catch (error) {
    console.error('Error getting video device split:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function getOperatingSystemSplit(req, res) {
  try {
    const operatingSystemSplit = await getOperatingSystemSplitInternal(
      { ...req.params, ...req.body, ...req.query },
      req.user?.sub || null,
    );
    return sendSuccess(res, { operatingSystemSplit }, 200);
  } catch (error) {
    console.error('Error getting video operating system split:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function getGeographicBreakdown(req, res) {
  try {
    const geographicBreakdown = await getGeographicBreakdownInternal(
      { ...req.params, ...req.body, ...req.query },
      req.user?.sub || null,
    );
    return sendSuccess(res, { geographicBreakdown }, 200);
  } catch (error) {
    console.error('Error getting video geographic breakdown:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function getViewsOverTime(req, res) {
  try {
    const viewsOverTime = await getViewsOverTimeInternal(
      { ...req.params, ...req.body, ...req.query },
      req.user?.sub || null,
    );
    return sendSuccess(res, { viewsOverTime }, 200);
  } catch (error) {
    console.error('Error getting video views over time:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function getWatchTimeOverTime(req, res) {
  try {
    const watchTimeOverTime = await getWatchTimeOverTimeInternal(
      { ...req.params, ...req.body, ...req.query },
      req.user?.sub || null,
    );
    return sendSuccess(res, { watchTimeOverTime }, 200);
  } catch (error) {
    console.error('Error getting video watch time over time:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function getCompletionBuckets(req, res) {
  try {
    const completionBuckets = await getCompletionBucketsInternal(
      { ...req.params, ...req.body, ...req.query },
      req.user?.sub || null,
    );
    return sendSuccess(res, { completionBuckets }, 200);
  } catch (error) {
    console.error('Error getting video completion buckets:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function getEngagement(req, res) {
  try {
    const engagement = await getEngagementInternal(
      { ...req.params, ...req.body, ...req.query },
      req.user?.sub || null,
    );
    return sendSuccess(res, { engagement }, 200);
  } catch (error) {
    console.error('Error getting video engagement:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function getChannelOverviewAnalytics(req, res) {
  try {
    const channelOverview = await getChannelOverviewAnalyticsInternal(
      { ...req.params, ...req.body, ...req.query },
      req.user?.sub || null,
    );
    return sendSuccess(res, { channelOverview }, 200);
  } catch (error) {
    console.error('Error getting channel overview analytics:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function getChannelDeviceSplit(req, res) {
  try {
    const channelDeviceSplit = await getChannelDeviceSplitInternal(
      { ...req.params, ...req.body, ...req.query },
      req.user?.sub || null,
    );
    return sendSuccess(res, { channelDeviceSplit }, 200);
  } catch (error) {
    console.error('Error getting channel device split:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function getChannelOperatingSystemSplit(req, res) {
  try {
    const channelOperatingSystemSplit = await getChannelOperatingSystemSplitInternal(
      { ...req.params, ...req.body, ...req.query },
      req.user?.sub || null,
    );
    return sendSuccess(res, { channelOperatingSystemSplit }, 200);
  } catch (error) {
    console.error('Error getting channel operating system split:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function getChannelGeographicBreakdown(req, res) {
  try {
    const channelGeographicBreakdown = await getChannelGeographicBreakdownInternal(
      { ...req.params, ...req.body, ...req.query },
      req.user?.sub || null,
    );
    return sendSuccess(res, { channelGeographicBreakdown }, 200);
  } catch (error) {
    console.error('Error getting channel geographic breakdown:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function getChannelViewsOverTime(req, res) {
  try {
    const channelViewsOverTime = await getChannelViewsOverTimeInternal(
      { ...req.params, ...req.body, ...req.query },
      req.user?.sub || null,
    );
    return sendSuccess(res, { channelViewsOverTime }, 200);
  } catch (error) {
    console.error('Error getting channel views over time:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function getChannelWatchTimeOverTime(req, res) {
  try {
    const channelWatchTimeOverTime = await getChannelWatchTimeOverTimeInternal(
      { ...req.params, ...req.body, ...req.query },
      req.user?.sub || null,
    );
    return sendSuccess(res, { channelWatchTimeOverTime }, 200);
  } catch (error) {
    console.error('Error getting channel watch time over time:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function getChannelAverageEngagementPerVideo(req, res) {
  try {
    const averageEngagementPerVideo = await getChannelAverageEngagementPerVideoInternal(
      { ...req.params, ...req.body, ...req.query },
      req.user?.sub || null,
    );
    return sendSuccess(res, { averageEngagementPerVideo }, 200);
  } catch (error) {
    console.error('Error getting channel average engagement per video:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function getPlatformOverviewAnalytics(req, res) {
  try {
    const platformOverview = await getPlatformOverviewAnalyticsInternal(
      { ...req.params, ...req.body, ...req.query },
      req.user?.sub || null,
    );
    return sendSuccess(res, { platformOverview }, 200);
  } catch (error) {
    console.error('Error getting platform overview analytics:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function getPlatformAverageEngagementPerVideo(req, res) {
  try {
    const averageEngagementPerVideo = await getPlatformAverageEngagementPerVideoInternal(
      { ...req.params, ...req.body, ...req.query },
      req.user?.sub || null,
    );
    return sendSuccess(res, { averageEngagementPerVideo }, 200);
  } catch (error) {
    console.error('Error getting platform average engagement per video:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function getPlatformTopViewedVideos(req, res) {
  try {
    const topViewedVideos = await getPlatformTopViewedVideosInternal(
      { ...req.params, ...req.body, ...req.query },
      req.user?.sub || null,
    );
    return sendSuccess(res, { topViewedVideos }, 200);
  } catch (error) {
    console.error('Error getting platform top viewed videos:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function getPlatformTopViewedPlaylists(req, res) {
  try {
    const topViewedPlaylists = await getPlatformTopViewedPlaylistsInternal(
      { ...req.params, ...req.body, ...req.query },
      req.user?.sub || null,
    );
    return sendSuccess(res, { topViewedPlaylists }, 200);
  } catch (error) {
    console.error('Error getting platform top viewed playlists:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function getPlatformDeviceSplit(req, res) {
  try {
    const platformDeviceSplit = await getPlatformDeviceSplitInternal(
      { ...req.params, ...req.body, ...req.query },
      req.user?.sub || null,
    );
    return sendSuccess(res, { platformDeviceSplit }, 200);
  } catch (error) {
    console.error('Error getting platform device split:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function getPlatformOperatingSystemSplit(req, res) {
  try {
    const platformOperatingSystemSplit = await getPlatformOperatingSystemSplitInternal(
      { ...req.params, ...req.body, ...req.query },
      req.user?.sub || null,
    );
    return sendSuccess(res, { platformOperatingSystemSplit }, 200);
  } catch (error) {
    console.error('Error getting platform operating system split:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function getPlatformGeographicBreakdown(req, res) {
  try {
    const platformGeographicBreakdown = await getPlatformGeographicBreakdownInternal(
      { ...req.params, ...req.body, ...req.query },
      req.user?.sub || null,
    );
    return sendSuccess(res, { platformGeographicBreakdown }, 200);
  } catch (error) {
    console.error('Error getting platform geographic breakdown:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function getPlatformViewsOverTime(req, res) {
  try {
    const platformViewsOverTime = await getPlatformViewsOverTimeInternal(
      { ...req.params, ...req.body, ...req.query },
      req.user?.sub || null,
    );
    return sendSuccess(res, { platformViewsOverTime }, 200);
  } catch (error) {
    console.error('Error getting platform views over time:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function getPlatformWatchTimeOverTime(req, res) {
  try {
    const platformWatchTimeOverTime = await getPlatformWatchTimeOverTimeInternal(
      { ...req.params, ...req.body, ...req.query },
      req.user?.sub || null,
    );
    return sendSuccess(res, { platformWatchTimeOverTime }, 200);
  } catch (error) {
    console.error('Error getting platform watch time over time:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function getPlatformSignupsOverTime(req, res) {
  try {
    const platformSignupsOverTime = await getPlatformSignupsOverTimeInternal(
      { ...req.params, ...req.body, ...req.query },
      req.user?.sub || null,
    );
    return sendSuccess(res, { platformSignupsOverTime }, 200);
  } catch (error) {
    console.error('Error getting platform signups over time:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function getPlatformActiveUsersOverTime(req, res) {
  try {
    const platformActiveUsersOverTime = await getPlatformActiveUsersOverTimeInternal(
      { ...req.params, ...req.body, ...req.query },
      req.user?.sub || null,
    );
    return sendSuccess(res, { platformActiveUsersOverTime }, 200);
  } catch (error) {
    console.error('Error getting platform active users over time:', error);
    return sendError(res, error.message, error.status || 500);
  }
}
