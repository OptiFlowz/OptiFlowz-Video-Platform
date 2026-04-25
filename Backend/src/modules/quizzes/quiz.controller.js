import { sendSuccess, sendError } from '../../common/response.js';
import { createVideoQuizInternal } from './handlers/createVideoQuiz.js';
import { updateVideoQuizInternal } from './handlers/updateVideoQuiz.js';
import { deleteVideoQuizInternal } from './handlers/deleteVideoQuiz.js';
import { getVideoQuizInternal } from './handlers/getVideoQuiz.js';

function getUserId(req) {
  return req.user?.sub || req.user?.id || null;
}

export async function createVideoQuiz(req, res) {
  try {
    const quiz = await createVideoQuizInternal({ ...req.params, ...req.body }, req.user?.sub || null);
    return sendSuccess(res, { quiz }, 201);
  } catch (error) {
    console.error('Error creating video quiz:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function updateVideoQuiz(req, res) {
  try {
    const quiz = await updateVideoQuizInternal({ ...req.params, ...req.body }, req.user?.sub || null);

    if (!quiz) {
      return sendError(res, 'Quiz not found', 404);
    }

    return sendSuccess(res, { quiz });
  } catch (error) {
    console.error('Error updating video quiz:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function deleteVideoQuiz(req, res) {
  try {
    const deleted = await deleteVideoQuizInternal(req.params, req.user?.sub || null);

    if (!deleted) {
      return sendError(res, 'Quiz not found', 404);
    }

    return sendSuccess(res, { deleted: true });
  } catch (error) {
    console.error('Error deleting video quiz:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function getVideoQuiz(req, res) {
  try {
    const quiz = await getVideoQuizInternal({ ...req.params},  req.user?.sub || null);

    if (!quiz) {
      return sendError(res, 'Quiz not found', 404);
    }

    return sendSuccess(res, { quiz });
  } catch (error) {
    console.error('Error fetching video quiz:', error);
    return sendError(res, error.message, error.status || 500);
  }
}