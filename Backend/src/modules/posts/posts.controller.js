import { editPostInternal } from './handlers/editPost.js';
import { sendSuccess, sendError } from '../../common/response.js';
import { validateOrThrow } from '../../common/input.validation.js';
import { recommendedPostsSchema } from './helpers/posts.shared.js';
import { createPostInternal } from './handlers/createPost.js';
import { getPostInternal } from './handlers/getPost.js';
import { getMyPostsInternal } from './handlers/getMyPosts.js';
import { getUserPostsInternal } from './handlers/getUserPosts.js';
import { deletePostInternal } from './handlers/deletePost.js';
import { appendPostBlockInternal } from './handlers/appendPostBlock.js';
import { deletePostBlockInternal } from './handlers/deletePostBlock.js';
import { editPostBlockInternal } from './handlers/editPostBlock.js';
import { addPostOptionInternal } from './handlers/addPostOption.js';
import { editPostOptionInternal } from './handlers/editPostOption.js';
import { deletePostOptionInternal } from './handlers/deletePostOption.js';
import { deletePostOptionImageInternal } from './handlers/deletePostOptionImage.js';
import { votePostPollInternal } from './handlers/votePostPoll.js';
import { answerPostQuestionerInternal } from './handlers/answerPostQuestioner.js';

export async function createPost(req, res) {
  try {
    const post = await createPostInternal(req.body, req.user?.sub);
    return sendSuccess(res, { post }, 201);
  } catch (error) {
    if (!error.status || error.status >= 500) console.error('createPost error:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function getPost(req, res) {
  try {
    const post = await getPostInternal(req.params, req.user?.sub || null, req.authorization);
    return sendSuccess(res, { post });
  } catch (error) {
    if (!error.status || error.status >= 500) console.error('getPost error:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function getMyPosts(req, res) {
  try {
    const result = await getMyPostsInternal(req.query, req.user?.sub);
    return sendSuccess(res, result);
  } catch (error) {
    if (!error.status || error.status >= 500) console.error('getMyPosts error:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function getUserPosts(req, res) {
  try {
    const result = await getUserPostsInternal(req.params.userId, req.query, req.user?.sub || null);
    return sendSuccess(res, result);
  } catch (error) {
    if (!error.status || error.status >= 500) console.error('getUserPosts error:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function getRecommendedPosts(req, res) {
  try {
    const { user_ids } = validateOrThrow(recommendedPostsSchema.safeParse(req.body));
    const result = await getUserPostsInternal(user_ids, req.query, req.user?.sub || null);
    return sendSuccess(res, result);
  } catch (error) {
    if (!error.status || error.status >= 500) console.error('getRecommendedPosts error:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function deletePost(req, res) {
  try {
    const result = await deletePostInternal(req.params, req.user?.sub, req.authorization);
    return sendSuccess(res, result);
  } catch (error) {
    if (!error.status || error.status >= 500) console.error('deletePost error:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function appendPostBlock(req, res) {
  try {
    const block = await appendPostBlockInternal(
      req.params, req.body, req.files || {}, req.user?.sub, req.authorization,
    );
    return sendSuccess(res, { block }, 201);
  } catch (error) {
    if (!error.status || error.status >= 500) console.error('appendPostBlock error:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function deletePostBlock(req, res) {
  try {
    const result = await deletePostBlockInternal(req.params, req.user?.sub, req.authorization);
    return sendSuccess(res, result);
  } catch (error) {
    if (!error.status || error.status >= 500) console.error('deletePostBlock error:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function editPostBlock(req, res) {
  try {
    const block = await editPostBlockInternal(req.params, req.body, req.file, req.user?.sub, req.authorization);
    return sendSuccess(res, { block });
  } catch (error) {
    if (!error.status || error.status >= 500) console.error('editPostBlock error:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function addPostOption(req, res) {
  try {
    const option = await addPostOptionInternal(req.params, req.body, req.file, req.user?.sub, req.authorization);
    return sendSuccess(res, { option }, 201);
  } catch (error) {
    if (!error.status || error.status >= 500) console.error('addPostOption error:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function editPostOption(req, res) {
  try {
    const option = await editPostOptionInternal(req.params, req.body, req.file, req.user?.sub, req.authorization);
    return sendSuccess(res, { option });
  } catch (error) {
    if (!error.status || error.status >= 500) console.error('editPostOption error:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function deletePostOption(req, res) {
  try {
    const result = await deletePostOptionInternal(req.params, req.user?.sub, req.authorization);
    return sendSuccess(res, result);
  } catch (error) {
    if (!error.status || error.status >= 500) console.error('deletePostOption error:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function deletePostOptionImage(req, res) {
  try {
    const option = await deletePostOptionImageInternal(req.params, req.user?.sub, req.authorization);
    return sendSuccess(res, { option });
  } catch (error) {
    if (!error.status || error.status >= 500) console.error('deletePostOptionImage error:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function votePostPoll(req, res) {
  try {
    const result = await votePostPollInternal(req.params, req.body, req.user?.sub, req.authorization);
    return sendSuccess(res, result);
  } catch (error) {
    if (!error.status || error.status >= 500) console.error('votePostPoll error:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function answerPostQuestioner(req, res) {
  try {
    const result = await answerPostQuestionerInternal(req.params, req.body, req.user?.sub, req.authorization);
    return sendSuccess(res, result);
  } catch (error) {
    if (!error.status || error.status >= 500) console.error('answerPostQuestioner error:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function editPost(req, res) {
  try {
    const post = await editPostInternal(req.params, req.body, req.user?.sub, req.authorization);
    return sendSuccess(res, { post });
  } catch (error) { return sendError(res, error.message, error.status || 500); }
}
