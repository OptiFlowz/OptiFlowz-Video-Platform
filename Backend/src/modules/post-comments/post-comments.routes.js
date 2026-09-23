import express from 'express';
import { requireAuth, optionalAuth } from '../../middleware/auth.js';
import { requirePermission } from '../authorization/authorization.middleware.js';
import { Permissions } from '../authorization/permission.constants.js';
import { requirePostCommentAccess } from '../authorization/resource-authorization.js';
import * as controller from './post-comments.controller.js';

const router = express.Router();
router.post('/post', requireAuth, requirePermission(Permissions.COMMENTS_CREATE), controller.postComment);
router.get('/:id/replies', optionalAuth, controller.getReplies);
router.post('/:id/like', requireAuth, requirePermission(Permissions.COMMENTS_REACT), controller.handleLikeComment);
router.post('/:id/dislike', requireAuth, requirePermission(Permissions.COMMENTS_REACT), controller.handleDislikeComment);
router.patch('/:id/edit', requireAuth, requirePostCommentAccess({
  ownPermission: Permissions.COMMENTS_EDIT_OWN,
}), controller.editComment);
router.delete('/:id/delete', requireAuth, requirePostCommentAccess({
  ownPermission: Permissions.COMMENTS_DELETE_OWN,
  anyPermission: Permissions.COMMENTS_MODERATE,
}), controller.deleteComment);

export default router;
