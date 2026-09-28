import { sendSuccess, sendError } from '../../common/response.js';
import { createLiveStreamInternal } from './handlers/createLiveStream.js';
import { getStreamingDetailsInternal } from './handlers/getStreamingDetails.js';
import { deleteLiveStreamInternal } from './handlers/deleteLiveStream.js';

export async function deleteLiveStream(req, res) {
  try {
    const result = await deleteLiveStreamInternal(req.params.liveStreamId, req.user?.sub);
    return sendSuccess(res, result);
  } catch (error) {
    if (!error.status || error.status >= 500) console.error('deleteLiveStream failed');
    return sendError(res, error.status ? error.message : 'Server error', error.status || 500);
  }
}

export async function getStreamingDetails(req, res) {
  res.set('Cache-Control', 'private, no-store');
  try {
    const result = await getStreamingDetailsInternal(req.params.liveStreamId, req.user?.sub);
    return sendSuccess(res, result);
  } catch (error) {
    if (!error.status || error.status >= 500) console.error('getStreamingDetails failed');
    return sendError(res, error.status ? error.message : 'Server error', error.status || 500);
  }
}

export async function createLiveStream(req, res) {
  try {
    const result = await createLiveStreamInternal(req.body, req.user?.sub);
    res.set('Cache-Control', 'no-store');
    return sendSuccess(res, result, 201);
  } catch (error) {
    // Do not log Mux response bodies, which may contain encoder credentials.
    if (!error.status || error.status >= 500) console.error('createLiveStream failed');
    return sendError(res, error.status ? error.message : 'Server error', error.status || 500);
  }
}
