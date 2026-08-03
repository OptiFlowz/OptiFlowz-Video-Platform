import { sendSuccess, sendError } from '../../common/response.js';
import { postCommentInternal } from './handlers/postComment.js';
import { getRepliesInternal } from './handlers/getReplies.js';
import { setCommentReactionInternal } from './handlers/setCommentReaction.js';
import { editCommentInternal } from './handlers/editComment.js';
import { deleteCommentInternal } from './handlers/deleteComment.js';


export async function postComment(req, res) {
  try {
    const comment = await postCommentInternal(req.body, req.user?.sub || null);
    return sendSuccess(res, { comment }, 201);
  } catch (error) {
    if(error.status!=403)
      console.error('postComment error:', error);
    return sendError(res, error.message, error.status || 500);
  }
}


export async function getReplies(req, res) {
  try {
    const result = await getRepliesInternal(
      { ...req.params, ...req.query },
      req.user?.sub || null
    );

    return sendSuccess(res, result);
  } catch (error) {
    console.error('getReplies error:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function handleLikeComment(req, res) {
  try {
    const result = await setCommentReactionInternal(
      req.params.id,
      req.user?.sub || null,
      'like'
    );

    return sendSuccess(res, result);
  } catch (error) {
    console.error('handleLikeComment error:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function handleDislikeComment(req, res) {
  try {
    const result = await setCommentReactionInternal(
      req.params.id,
      req.user?.sub || null,
      'dislike'
    );

    return sendSuccess(res, result);
  } catch (error) {
    console.error('handleDislikeComment error:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function editComment(req, res) {
  try {
    const comment = await editCommentInternal(
      req.params,
      req.body,
      req.user?.sub || null
    );

    return sendSuccess(res, { comment });
  } catch (error) {
    console.error('editComment error:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function deleteComment(req, res) {
  try {
    const result = await deleteCommentInternal(
      req.params,
      req.user?.sub || null,
      req.authorization
    );

    return sendSuccess(res, result);
  } catch (error) {
    console.error('deleteComment error:', error)
    return sendError(res, error.message, error.status || 500);
  }
}
