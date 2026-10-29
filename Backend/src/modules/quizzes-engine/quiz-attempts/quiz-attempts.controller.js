import { checkQuizAttemptAnswerInternal } from './handlers/checkQuizAttemptAnswer.js';
import { sendSuccess, sendError } from '../../../common/response.js';
import { getQuizEligibilityInternal } from './handlers/getQuizEligibility.js';
import { startQuizAttemptInternal } from './handlers/startQuizAttempt.js';
import { getQuizAttemptsInternal } from './handlers/getQuizAttempts.js';
import { saveQuizAttemptAnswerInternal } from './handlers/saveQuizAttemptAnswer.js';
import { getQuizAttemptQuestionsInternal } from './handlers/getQuizAttemptQuestions.js';
import { submitQuizAttemptInternal } from './handlers/submitQuizAttempt.js';
import { getQuizResultsInternal } from './handlers/getQuizResults.js';
import { getQuizResultInternal } from './handlers/getQuizResult.js';
import { deleteQuizAttemptInternal } from './handlers/deleteQuizAttempt.js';

export async function getQuizResults(req, res) {
  res.set('Cache-Control', 'private, no-store');
  try {
    return sendSuccess(res, await getQuizResultsInternal(req.params, req.query, req.resourceOwnerId));
  } catch (error) {
    if (!error.status || error.status >= 500) console.error('getQuizResults error:', error);
    return sendError(res, error.status && error.status < 500 ? error.message : 'Unable to list quiz results', error.status || 500);
  }
}

export async function getQuizResult(req, res) {
  res.set('Cache-Control', 'private, no-store');
  try {
    return sendSuccess(res, await getQuizResultInternal(req.params, req.resourceOwnerId));
  } catch (error) {
    if (!error.status || error.status >= 500) console.error('getQuizResult error:', error);
    return sendError(res, error.status && error.status < 500 ? error.message : 'Unable to get quiz result', error.status || 500);
  }
}

export async function deleteQuizAttempt(req, res) {
  res.set('Cache-Control', 'private, no-store');
  try {
    return sendSuccess(res, await deleteQuizAttemptInternal(req.params, req.resourceOwnerId));
  } catch (error) {
    if (!error.status || error.status >= 500) console.error('deleteQuizAttempt error:', error);
    return sendError(res, error.status && error.status < 500 ? error.message : 'Unable to delete quiz attempt', error.status || 500,
      error.status && error.status < 500 && error.body?.code ? { code: error.body.code } : {});
  }
}

export async function submitQuizAttempt(req, res) {
  res.set('Cache-Control', 'private, no-store');
  try {
    return sendSuccess(res, await submitQuizAttemptInternal(req.params.attemptId, req.user?.sub));
  } catch (error) {
    if (!error.status || error.status >= 500) console.error('submitQuizAttempt error:', error);
    return sendError(res, error.status && error.status < 500 ? error.message : 'Unable to submit the quiz attempt', error.status || 500,
      error.status && error.status < 500 && error.body?.code ? { code: error.body.code } : {});
  }
}

export async function getQuizAttemptQuestions(req, res) {
  res.set('Cache-Control', 'private, no-store');
  try {
    return sendSuccess(res, await getQuizAttemptQuestionsInternal(req.params.attemptId, req.user?.sub));
  } catch (error) {
    if (!error.status || error.status >= 500) console.error('getQuizAttemptQuestions error:', error);
    return sendError(res, error.status && error.status < 500 ? error.message : 'Unable to get attempt questions', error.status || 500,
      error.status && error.status < 500 && error.body?.code ? { code: error.body.code } : {});
  }
}

export async function checkQuizAttemptAnswer(req, res) {
  res.set('Cache-Control', 'private, no-store');
  try {
    return sendSuccess(res, await checkQuizAttemptAnswerInternal(req.params, req.user?.sub));
  } catch (error) {
    if (!error.status || error.status >= 500) console.error('checkQuizAttemptAnswer error:', error);
    return sendError(res, error.status && error.status < 500 ? error.message : 'Unable to check the quiz answer', error.status || 500,
      error.status && error.status < 500 && error.body?.code ? { code: error.body.code } : {});
  }
}

export async function saveQuizAttemptAnswer(req, res) {
  res.set('Cache-Control', 'private, no-store');
  try {
    return sendSuccess(res, await saveQuizAttemptAnswerInternal(req.params, req.body, req.user?.sub));
  } catch (error) {
    if (!error.status || error.status >= 500) console.error('saveQuizAttemptAnswer error:', error);
    return sendError(res, error.status && error.status < 500 ? error.message : 'Unable to save the quiz answer', error.status || 500,
      error.status && error.status < 500 && error.body?.code ? { code: error.body.code } : {});
  }
}

export async function getQuizAttempts(req, res) {
  res.set('Cache-Control', 'private, no-store');
  try {
    return sendSuccess(res, await getQuizAttemptsInternal(req.params.quizId, req.query, req.user?.sub));
  } catch (error) {
    if (!error.status || error.status >= 500) console.error('getQuizAttempts error:', error);
    return sendError(res, error.status && error.status < 500 ? error.message : 'Unable to list quiz attempts', error.status || 500);
  }
}

export async function startQuizAttempt(req, res) {
  res.set('Cache-Control', 'private, no-store');
  try {
    const result = await startQuizAttemptInternal(req.params.quizId, req.user?.sub);
    return sendSuccess(res, result.attempt, result.created ? 201 : 200);
  } catch (error) {
    if (!error.status || error.status >= 500) console.error('startQuizAttempt error:', error);
    return sendError(res, error.status && error.status < 500 ? error.message : 'Unable to start the quiz attempt', error.status || 500,
      error.status && error.status < 500 && error.body?.code ? { code: error.body.code } : {});
  }
}

export async function getQuizEligibility(req, res) {
  res.set('Cache-Control', 'private, no-store');
  try {
    return sendSuccess(res, await getQuizEligibilityInternal(req.params.quizId, req.user?.sub));
  } catch (error) {
    if (!error.status || error.status >= 500) console.error('getQuizEligibility error:', error);
    return sendError(res, error.status && error.status < 500 ? error.message : 'Unable to process the quiz attempt request', error.status || 500);
  }
}
