import { sendSuccess, sendError } from '../../../common/response.js';
import { getQuizEligibilityInternal } from './handlers/getQuizEligibility.js';
import { startQuizAttemptInternal } from './handlers/startQuizAttempt.js';

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
