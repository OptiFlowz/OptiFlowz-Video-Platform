import { sendSuccess, sendError } from '../../../common/response.js';
import { createQuizRequirementInternal } from './handlers/createQuizRequirement.js';
import { getQuizRequirementsInternal } from './handlers/getQuizRequirements.js';
import { getQuizRequirementInternal } from './handlers/getQuizRequirement.js';
import { updateQuizRequirementInternal } from './handlers/updateQuizRequirement.js';
import { deleteQuizRequirementInternal } from './handlers/deleteQuizRequirement.js';
import { checkQuizRequirementsInternal } from './handlers/checkQuizRequirements.js';
import { getQuizRequirementsProgressInternal } from './handlers/getQuizRequirementsProgress.js';

function handleError(res, error, action) {
  if (!error.status || error.status >= 500) console.error(`${action} error:`, error);
  return sendError(res, error.status && error.status < 500 ? error.message : 'Unable to process the quiz requirement request', error.status || 500);
}

export async function createQuizRequirement(req, res) {
  try {
    const requirement = await createQuizRequirementInternal(req.body, req.user?.sub);
    return sendSuccess(res, { requirement }, 201);
  } catch (error) { return handleError(res, error, 'createQuizRequirement'); }
}

export async function getQuizRequirements(req, res) {
  try {
    return sendSuccess(res, await getQuizRequirementsInternal(req.query, req.user?.sub));
  } catch (error) { return handleError(res, error, 'getQuizRequirements'); }
}

export async function checkQuizRequirements(req, res) {
  res.set('Cache-Control', 'private, no-store');
  try {
    const requirements_met = await checkQuizRequirementsInternal(req.params.quizId, req.user?.sub);
    return sendSuccess(res, { requirements_met });
  } catch (error) { return handleError(res, error, 'checkQuizRequirements'); }
}

export async function getQuizRequirementsProgress(req, res) {
  res.set('Cache-Control', 'private, no-store');
  try {
    return sendSuccess(res, await getQuizRequirementsProgressInternal(req.params.quizId, req.user?.sub));
  } catch (error) { return handleError(res, error, 'getQuizRequirementsProgress'); }
}

export async function getQuizRequirement(req, res) {
  try {
    const requirement = await getQuizRequirementInternal(req.params, req.user?.sub);
    return sendSuccess(res, { requirement });
  } catch (error) { return handleError(res, error, 'getQuizRequirement'); }
}

export async function updateQuizRequirement(req, res) {
  try {
    const requirement = await updateQuizRequirementInternal(req.params, req.body, req.user?.sub);
    return sendSuccess(res, { requirement });
  } catch (error) { return handleError(res, error, 'updateQuizRequirement'); }
}

export async function deleteQuizRequirement(req, res) {
  try {
    return sendSuccess(res, await deleteQuizRequirementInternal(req.params, req.user?.sub));
  } catch (error) { return handleError(res, error, 'deleteQuizRequirement'); }
}
