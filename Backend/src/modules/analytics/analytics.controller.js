import { sendSuccess, sendError } from '../../common/response.js';
import { getOverviewVideoAnalyticsInternal } from './handlers/getOverviewVideoAnalytics.js';
import { getDeviceSplitInternal } from './handlers/getDeviceSplit.js';
import { getOperatingSystemSplitInternal } from './handlers/getOperatingSystemSplit.js';
import { getGeographicBreakdownInternal } from './handlers/getGeographicBreakdown.js';



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
