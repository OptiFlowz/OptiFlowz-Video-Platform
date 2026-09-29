import { sendSuccess, sendError } from '../../common/response.js';
import { createLiveStreamInternal } from './handlers/createLiveStream.js';
import { getStreamingDetailsInternal } from './handlers/getStreamingDetails.js';
import { deleteLiveStreamInternal } from './handlers/deleteLiveStream.js';
import { liveThumbnailUploadInternal } from './handlers/liveThumbnailUpload.js';
import { getMyLiveStreamsInternal } from './handlers/getMyLiveStreams.js';
import { updateLiveDetailsInternal } from './handlers/updateLiveDetails.js';
import { getUserLiveCardsInternal } from './handlers/getUserLiveCards.js';
import { getLivePlaybackInternal } from './handlers/getLivePlayback.js';
import { getLiveDetailsInternal } from './handlers/getLiveDetails.js';

export async function getLiveDetails(req, res) {
  res.set('Cache-Control', 'private, no-store');
  try {
    return sendSuccess(res, await getLiveDetailsInternal(req.params.liveStreamId, req.user?.sub));
  } catch (error) {
    if (!error.status || error.status >= 500) console.error('getLiveDetails failed');
    return sendError(res, error.status ? error.message : 'Server error', error.status || 500);
  }
}

export async function getLivePlayback(req, res) {
  res.set('Cache-Control', 'private, no-store');
  try {
    return sendSuccess(res, await getLivePlaybackInternal(req.params.liveStreamId, req.user?.sub));
  } catch (error) {
    if (!error.status || error.status >= 500) console.error('getLivePlayback failed');
    return sendError(res, error.status ? error.message : 'Server error', error.status || 500);
  }
}

export async function getUserLiveCards(req, res) {
  res.set('Cache-Control', 'private, no-store');
  try {
    const result = await getUserLiveCardsInternal({ params: req.params, query: req.query }, req.user?.sub);
    return sendSuccess(res, result);
  } catch (error) {
    if (!error.status || error.status >= 500) console.error('getUserLiveCards failed');
    return sendError(res, error.status ? error.message : 'Server error', error.status || 500);
  }
}

export async function updateLiveDetails(req, res) {
  res.set('Cache-Control', 'private, no-store');
  try {
    const result = await updateLiveDetailsInternal({ params: req.params, body: req.body }, req.user?.sub);
    return sendSuccess(res, result);
  } catch (error) {
    if (!error.status || error.status >= 500) console.error('updateLiveDetails failed');
    return sendError(res, error.status ? error.message : 'Server error', error.status || 500);
  }
}

export async function getMyLiveStreams(req, res) {
  res.set('Cache-Control', 'private, no-store');
  try {
    const result = await getMyLiveStreamsInternal({ query: req.query }, req.user?.sub);
    return sendSuccess(res, result);
  } catch (error) {
    if (!error.status || error.status >= 500) console.error('getMyLiveStreams failed');
    return sendError(res, error.status ? error.message : 'Server error', error.status || 500);
  }
}

export async function uploadLiveThumbnail(req, res) {
  try {
    const result = await liveThumbnailUploadInternal({ params: req.params, file: req.file }, req.user?.sub);
    return sendSuccess(res, result);
  } catch (error) {
    if (!error.status || error.status >= 500) console.error('uploadLiveThumbnail failed');
    return sendError(res, error.status ? error.message : 'Server error', error.status || 500);
  }
}

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
