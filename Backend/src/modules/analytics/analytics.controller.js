import { sendSuccess, sendError } from '../../common/response.js';
import { getOverviewVideoAnalyticsInternal } from './handlers/getOverviewVideoAnalytics.js';
import { getDeviceSplitInternal } from './handlers/getDeviceSplit.js';
import { getOperatingSystemSplitInternal } from './handlers/getOperatingSystemSplit.js';
import { getGeographicBreakdownInternal } from './handlers/getGeographicBreakdown.js';
import { getViewsOverTimeInternal } from './handlers/getViewsOverTime.js';
import { getWatchTimeOverTimeInternal } from './handlers/getWatchTimeOverTime.js';
import { getCompletionBucketsInternal } from './handlers/getCompletionBuckets.js';
import { getEngagementInternal } from './handlers/getEngagement.js';
import { getChannelOverviewAnalyticsInternal } from './handlers/getChannelOverviewAnalytics.js';
import { getChannelDeviceSplitInternal } from './handlers/getChannelDeviceSplit.js';
import { getChannelOperatingSystemSplitInternal } from './handlers/getChannelOperatingSystemSplit.js';
import { getChannelGeographicBreakdownInternal } from './handlers/getChannelGeographicBreakdown.js';
import { getChannelViewsOverTimeInternal } from './handlers/getChannelViewsOverTime.js';
import { getChannelWatchTimeOverTimeInternal } from './handlers/getChannelWatchTimeOverTime.js';



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
