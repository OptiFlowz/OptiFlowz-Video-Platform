import { sendSuccess, sendError } from '../../../common/response.js';
import { createQuestionInternal } from './handlers/createQuestion.js';
import { getQuestionsInternal } from './handlers/getQuestions.js';
import { getQuestionInternal } from './handlers/getQuestion.js';
import { updateQuestionInternal } from './handlers/updateQuestion.js';
import { deleteQuestionInternal } from './handlers/deleteQuestion.js';

function handleQuestionError(res, error, action) {
  if (!error.status || error.status >= 500) console.error(`${action} error:`, error);
  return sendError(res, error.status && error.status < 500 ? error.message : 'Unable to process the question request', error.status || 500);
}

export async function createQuestion(req, res) {
  try {
    const question = await createQuestionInternal(req.body, req.user?.sub);
    return sendSuccess(res, { question }, 201);
  } catch (error) { return handleQuestionError(res, error, 'createQuestion'); }
}

export async function getQuestions(req, res) {
  try {
    return sendSuccess(res, await getQuestionsInternal(req.query, req.user?.sub));
  } catch (error) { return handleQuestionError(res, error, 'getQuestions'); }
}

export async function getQuestion(req, res) {
  try {
    const question = await getQuestionInternal(req.params, req.user?.sub);
    return sendSuccess(res, { question });
  } catch (error) { return handleQuestionError(res, error, 'getQuestion'); }
}

export async function updateQuestion(req, res) {
  try {
    const question = await updateQuestionInternal(req.params, req.body, req.user?.sub);
    return sendSuccess(res, { question });
  } catch (error) { return handleQuestionError(res, error, 'updateQuestion'); }
}

export async function deleteQuestion(req, res) {
  try {
    return sendSuccess(res, await deleteQuestionInternal(req.params, req.user?.sub));
  } catch (error) { return handleQuestionError(res, error, 'deleteQuestion'); }
}
