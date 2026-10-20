import { sendSuccess, sendError } from '../../../common/response.js';
import { createQuestionCategoryInternal } from './handlers/createQuestionCategory.js';
import { getQuestionCategoriesInternal } from './handlers/getQuestionCategories.js';
import { getQuestionCategoryInternal } from './handlers/getQuestionCategory.js';
import { updateQuestionCategoryInternal } from './handlers/updateQuestionCategory.js';
import { deleteQuestionCategoryInternal } from './handlers/deleteQuestionCategory.js';
import { syncQuestionCategoryQuestionsInternal } from './handlers/syncQuestionCategoryQuestions.js';

function handleCategoryError(res, error, action) {
  if (!error.status || error.status >= 500) console.error(`${action} error:`, error);
  return sendError(res, error.status && error.status < 500 ? error.message : 'Unable to process the question category request', error.status || 500);
}

export async function createQuestionCategory(req, res) {
  try {
    const category = await createQuestionCategoryInternal(req.body, req.user?.sub);
    return sendSuccess(res, { category }, 201);
  } catch (error) { return handleCategoryError(res, error, 'createQuestionCategory'); }
}

export async function getQuestionCategories(req, res) {
  try {
    return sendSuccess(res, await getQuestionCategoriesInternal(req.query, req.resourceOwnerId ?? req.user?.sub, req.resourceAccess));
  } catch (error) { return handleCategoryError(res, error, 'getQuestionCategories'); }
}

export async function getQuestionCategory(req, res) {
  try {
    const category = await getQuestionCategoryInternal(req.params, req.resourceOwnerId ?? req.user?.sub);
    return sendSuccess(res, { category });
  } catch (error) { return handleCategoryError(res, error, 'getQuestionCategory'); }
}

export async function updateQuestionCategory(req, res) {
  try {
    const category = await updateQuestionCategoryInternal(req.params, req.body, req.resourceOwnerId ?? req.user?.sub);
    return sendSuccess(res, { category });
  } catch (error) { return handleCategoryError(res, error, 'updateQuestionCategory'); }
}

export async function deleteQuestionCategory(req, res) {
  try {
    return sendSuccess(res, await deleteQuestionCategoryInternal(req.params, req.resourceOwnerId ?? req.user?.sub));
  } catch (error) { return handleCategoryError(res, error, 'deleteQuestionCategory'); }
}

export async function syncQuestionCategoryQuestions(req, res) {
  try {
    return sendSuccess(res, await syncQuestionCategoryQuestionsInternal(req.params, req.body, req.resourceOwnerId ?? req.user?.sub));
  } catch (error) { return handleCategoryError(res, error, 'syncQuestionCategoryQuestions'); }
}
