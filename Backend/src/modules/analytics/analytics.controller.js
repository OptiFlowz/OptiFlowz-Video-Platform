import { sendSuccess, sendError } from '../../common/response.js';
import { getOverviewVideoAnalyticsInternal } from './handlers/getOverviewVideoAnalytics.js';



export async function getOverviewVideoAnalytics(req, res) {
  try {
    const overview = await getOverviewVideoAnalyticsInternal({ ...req.params, ...req.body, ...req.query}, req.user?.sub || null);
    return sendSuccess(res, { overview }, 200);
  } catch (error) {
    console.error('Error creating video overview:', error);
    return sendError(res, error.message, error.status || 500);
  }
}
