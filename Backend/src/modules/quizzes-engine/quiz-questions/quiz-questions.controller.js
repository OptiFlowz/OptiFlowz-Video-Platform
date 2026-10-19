import { sendSuccess, sendError } from '../../../common/response.js';
import { createQuizQuestionInternal } from './handlers/createQuizQuestion.js';
import { getQuizQuestionsInternal } from './handlers/getQuizQuestions.js';
import { getQuizQuestionInternal } from './handlers/getQuizQuestion.js';
import { updateQuizQuestionInternal } from './handlers/updateQuizQuestion.js';
import { deleteQuizQuestionInternal } from './handlers/deleteQuizQuestion.js';

function handleError(res, error, action) {
  if (!error.status || error.status >= 500) console.error(`${action} error:`, error);
  return sendError(res, error.status && error.status < 500 ? error.message : 'Unable to process the quiz question request', error.status || 500);
}

export async function createQuizQuestion(req, res) {
  try {
    const quiz_question = await createQuizQuestionInternal(req.params, req.body, req.resourceOwnerId ?? req.user?.sub);
    return sendSuccess(res, { quiz_question }, 201);
  } catch (error) { return handleError(res, error, 'createQuizQuestion'); }
}

export async function getQuizQuestions(req, res) {
  res.set('Cache-Control', 'private, no-store');
  try {
    return sendSuccess(res, await getQuizQuestionsInternal(req.params, req.query, req.resourceOwnerId ?? req.user?.sub));
  } catch (error) { return handleError(res, error, 'getQuizQuestions'); }
}

export async function getQuizQuestion(req, res) {
  res.set('Cache-Control', 'private, no-store');
  try {
    const quiz_question = await getQuizQuestionInternal(req.params, req.resourceOwnerId ?? req.user?.sub);
    return sendSuccess(res, { quiz_question });
  } catch (error) { return handleError(res, error, 'getQuizQuestion'); }
}

export async function updateQuizQuestion(req, res) {
  try {
    const quiz_question = await updateQuizQuestionInternal(req.params, req.body, req.resourceOwnerId ?? req.user?.sub);
    return sendSuccess(res, { quiz_question });
  } catch (error) { return handleError(res, error, 'updateQuizQuestion'); }
}

export async function deleteQuizQuestion(req, res) {
  try {
    return sendSuccess(res, await deleteQuizQuestionInternal(req.params, req.resourceOwnerId ?? req.user?.sub));
  } catch (error) { return handleError(res, error, 'deleteQuizQuestion'); }
}
