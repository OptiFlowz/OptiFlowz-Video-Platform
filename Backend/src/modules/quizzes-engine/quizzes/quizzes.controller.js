import { sendSuccess, sendError } from '../../../common/response.js';
import { createQuizInternal } from './handlers/createQuiz.js';
import { getQuizzesInternal } from './handlers/getQuizzes.js';
import { getQuizInternal } from './handlers/getQuiz.js';
import { updateQuizInternal } from './handlers/updateQuiz.js';
import { deleteQuizInternal } from './handlers/deleteQuiz.js';

function handleQuizError(res, error, action) {
  if (!error.status || error.status >= 500) console.error(`${action} error:`, error);
  return sendError(res, error.status && error.status < 500 ? error.message : 'Unable to process the quiz request', error.status || 500);
}

export async function createQuiz(req, res) {
  try {
    const quiz = await createQuizInternal(req.body, req.user?.sub);
    return sendSuccess(res, { quiz }, 201);
  } catch (error) { return handleQuizError(res, error, 'createQuiz'); }
}

export async function getQuizzes(req, res) {
  try {
    return sendSuccess(res, await getQuizzesInternal(req.query, req.user?.sub));
  } catch (error) { return handleQuizError(res, error, 'getQuizzes'); }
}

export async function getQuiz(req, res) {
  try {
    const quiz = await getQuizInternal(req.params, req.user?.sub);
    return sendSuccess(res, { quiz });
  } catch (error) { return handleQuizError(res, error, 'getQuiz'); }
}

export async function updateQuiz(req, res) {
  try {
    const quiz = await updateQuizInternal(req.params, req.body, req.user?.sub);
    return sendSuccess(res, { quiz });
  } catch (error) { return handleQuizError(res, error, 'updateQuiz'); }
}

export async function deleteQuiz(req, res) {
  try {
    return sendSuccess(res, await deleteQuizInternal(req.params, req.user?.sub));
  } catch (error) { return handleQuizError(res, error, 'deleteQuiz'); }
}
