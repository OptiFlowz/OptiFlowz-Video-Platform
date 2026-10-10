import { sendSuccess, sendError } from '../../../common/response.js';
import { createQuestionGroupInternal } from './handlers/createQuestionGroup.js';
import { getQuestionGroupsInternal } from './handlers/getQuestionGroups.js';
import { getQuestionGroupInternal } from './handlers/getQuestionGroup.js';
import { updateQuestionGroupInternal } from './handlers/updateQuestionGroup.js';
import { deleteQuestionGroupInternal } from './handlers/deleteQuestionGroup.js';

function handleGroupError(res, error, action) {
  if (!error.status || error.status >= 500) console.error(`${action} error:`, error);
  return sendError(res, error.status && error.status < 500 ? error.message : 'Unable to process the question group request', error.status || 500);
}

export async function createQuestionGroup(req, res) {
  try {
    const group = await createQuestionGroupInternal(req.body, req.user?.sub);
    return sendSuccess(res, { group }, 201);
  } catch (error) { return handleGroupError(res, error, 'createQuestionGroup'); }
}

export async function getQuestionGroups(req, res) {
  try {
    return sendSuccess(res, await getQuestionGroupsInternal(req.query, req.user?.sub));
  } catch (error) { return handleGroupError(res, error, 'getQuestionGroups'); }
}

export async function getQuestionGroup(req, res) {
  try {
    const group = await getQuestionGroupInternal(req.params, req.user?.sub);
    return sendSuccess(res, { group });
  } catch (error) { return handleGroupError(res, error, 'getQuestionGroup'); }
}

export async function updateQuestionGroup(req, res) {
  try {
    const group = await updateQuestionGroupInternal(req.params, req.body, req.user?.sub);
    return sendSuccess(res, { group });
  } catch (error) { return handleGroupError(res, error, 'updateQuestionGroup'); }
}

export async function deleteQuestionGroup(req, res) {
  try {
    return sendSuccess(res, await deleteQuestionGroupInternal(req.params, req.user?.sub));
  } catch (error) { return handleGroupError(res, error, 'deleteQuestionGroup'); }
}
