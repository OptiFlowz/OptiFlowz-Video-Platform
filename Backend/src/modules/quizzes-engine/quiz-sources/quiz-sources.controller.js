import { sendSuccess, sendError } from '../../../common/response.js';
import { createQuizSourceInternal } from './handlers/createQuizSource.js';
import { replaceQuizSourcesInternal } from './handlers/replaceQuizSources.js';
import { getQuizSourcesInternal } from './handlers/getQuizSources.js';
import { getQuizSourceInternal } from './handlers/getQuizSource.js';
import { updateQuizSourceInternal } from './handlers/updateQuizSource.js';
import { deleteQuizSourceInternal } from './handlers/deleteQuizSource.js';

function handleError(res, error, action) {
  if (!error.status || error.status >= 500) console.error(`${action} error:`, error);
  return sendError(res, error.status && error.status < 500 ? error.message : 'Unable to process the quiz source request', error.status || 500);
}

export async function createQuizSource(req, res) {
  try {
    const result = await createQuizSourceInternal(req.params, req.body, req.user?.sub);
    return sendSuccess(res, { source: result }, 201);
  } catch (error) { return handleError(res, error, 'createQuizSource'); }
}

export async function replaceQuizSources(req, res) {
  try {
    const result = await replaceQuizSourcesInternal(req.params, req.body, req.user?.sub);
    return sendSuccess(res, result, 200);
  } catch (error) { return handleError(res, error, 'replaceQuizSources'); }
}

export async function getQuizSources(req, res) {
  res.set('Cache-Control', 'private, no-store');
  try {
    const result = await getQuizSourcesInternal(req.params, req.query, req.user?.sub);
    return sendSuccess(res, result, 200);
  } catch (error) { return handleError(res, error, 'getQuizSources'); }
}

export async function getQuizSource(req, res) {
  res.set('Cache-Control', 'private, no-store');
  try {
    const result = await getQuizSourceInternal(req.params, req.user?.sub);
    return sendSuccess(res, { source: result }, 200);
  } catch (error) { return handleError(res, error, 'getQuizSource'); }
}

export async function updateQuizSource(req, res) {
  try {
    const result = await updateQuizSourceInternal(req.params, req.body, req.user?.sub);
    return sendSuccess(res, { source: result }, 200);
  } catch (error) { return handleError(res, error, 'updateQuizSource'); }
}

export async function deleteQuizSource(req, res) {
  try {
    const result = await deleteQuizSourceInternal(req.params, req.user?.sub);
    return sendSuccess(res, result, 200);
  } catch (error) { return handleError(res, error, 'deleteQuizSource'); }
}
