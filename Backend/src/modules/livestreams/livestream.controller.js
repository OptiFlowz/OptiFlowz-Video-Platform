import { sendSuccess, sendError } from '../../common/response.js';
import { createLivestreamInternal } from './handlers/createLivestream.js';
import { listLivestreamsInternal } from './handlers/listLivestreams.js';
import { getLivestreamCredentialsInternal, endLivestreamInternal, updateLivestreamSettingsInternal } from './handlers/manageLivestream.js';

const handle = fn => async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  try { return sendSuccess(res, await fn(req)); }
  catch (error) { return sendError(res, error.status && error.status < 500 ? error.message : 'Livestream operation failed', error.status && error.status < 500 ? error.status : 502); }
};
export const listLivestreams = handle(req => listLivestreamsInternal(req.query, req.user?.sub));
export const listMyLivestreams = handle(req => listLivestreamsInternal(req.query, req.user.sub, true));
export const listChannelLivestreams = handle(req => listLivestreamsInternal({ ...req.query, channel_id: req.params.id }, req.user?.sub));
export const getLivestreamCredentials = handle(req => getLivestreamCredentialsInternal(req.params.videoId));
export const endLivestream = handle(req => endLivestreamInternal(req.params.videoId));
export const updateLivestreamSettings = handle(req => updateLivestreamSettingsInternal(req.params.videoId, req.body));

export async function createLivestream(req, res) {
  res.set('Cache-Control', 'private, no-store');
  try {
    const livestream = await createLivestreamInternal(req.body, req.user?.sub);
    return sendSuccess(res, { livestream }, 201);
  } catch (error) {
    return sendError(res, error.status ? error.message : 'Failed to create livestream', error.status || 500);
  }
}
