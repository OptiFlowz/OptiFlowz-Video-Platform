import { sendSuccess, sendError } from '../../../common/response.js';
import { getQuizEligibilityInternal } from './handlers/getQuizEligibility.js';

export async function getQuizEligibility(req, res) {
  res.set('Cache-Control', 'private, no-store');
  try {
    return sendSuccess(res, await getQuizEligibilityInternal(req.params.quizId, req.user?.sub));
  } catch (error) {
    if (!error.status || error.status >= 500) console.error('getQuizEligibility error:', error);
    return sendError(res, error.status && error.status < 500 ? error.message : 'Unable to process the quiz attempt request', error.status || 500);
  }
}
