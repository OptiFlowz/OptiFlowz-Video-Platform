import { sendSuccess, sendError } from '../../common/response.js';
import { postCommentInternal } from './handlers/postComment.js';
// import { getRepliesInternal } from './handlers/getReplies.js';
// import { setCommentReaction } from './handlers/setCommentReaction.js';
// import { editCommentInternal } from './handlers/editComment.js';
// import { deleteCommentInternal } from './handlers/deleteComment.js';


export async function postComment(req, res) {
  try {
    const comment = await postCommentInternal(req.body, req.user?.sub || null);
    return sendSuccess(res, { comment }, 201);
  } catch (error) {
    console.error('postComment error:', error);
    return sendError(res, error.message, error.status || 500);
  }
}
