import express from 'express';
import { optionalAuth, requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../authorization/authorization.middleware.js';
import { Permissions } from '../authorization/permission.constants.js';
import * as postsController from './posts.controller.js';
import { requirePostEditAccess, requirePostDeleteAccess, postBlockUpload, postEditUpload } from './posts.middleware.js';

const router = express.Router();

router.get('/my', requireAuth, postsController.getMyPosts);
router.get('/details/:postId', optionalAuth, postsController.getPost);
router.get('/:userId', optionalAuth, postsController.getUserPosts);

router.use(requireAuth);
router.post('/', requirePermission(Permissions.POSTS_CREATE), postsController.createPost);
router.delete('/:postId', requirePostDeleteAccess, postsController.deletePost);
router.post('/:postId/blocks', requirePostEditAccess, postBlockUpload, postsController.appendPostBlock);
router.post('/:postId/blocks/:blockId/vote', requirePermission(Permissions.POSTS_POLL_VOTE), postsController.votePostPoll);
router.post('/:postId/blocks/:blockId/answer', requirePermission(Permissions.POSTS_QUESTIONER_ANSWER), postsController.answerPostQuestioner);
router.delete('/:postId/blocks/:blockId', requirePostEditAccess, postsController.deletePostBlock);
router.patch('/:postId/blocks/:blockId', requirePostEditAccess, postEditUpload, postsController.editPostBlock);
router.post('/:postId/blocks/:blockId/options', requirePostEditAccess, postEditUpload, postsController.addPostOption);
router.patch('/:postId/blocks/:blockId/options/:optionId', requirePostEditAccess, postEditUpload, postsController.editPostOption);
router.delete('/:postId/blocks/:blockId/options/:optionId', requirePostEditAccess, postsController.deletePostOption);
router.delete('/:postId/blocks/:blockId/options/:optionId/image', requirePostEditAccess, postsController.deletePostOptionImage);

export default router;
