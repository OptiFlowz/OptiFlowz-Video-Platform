import express from 'express';
import { requireAuth, optionalAuth } from '../../middleware/auth.js';
import { requirePermission } from '../authorization/authorization.middleware.js';
import { Permissions } from '../authorization/permission.constants.js';
import { requireCommentAccess } from '../authorization/resource-authorization.js';
import * as commentsController from './comments.controller.js';

const router = express.Router();

router.post('/post', requireAuth, requirePermission(Permissions.COMMENTS_CREATE), commentsController.postComment)
router.get('/:id/replies',optionalAuth,commentsController.getReplies)
router.post("/:id/like", requireAuth, requirePermission(Permissions.COMMENTS_REACT), commentsController.handleLikeComment);
router.post("/:id/dislike", requireAuth, requirePermission(Permissions.COMMENTS_REACT), commentsController.handleDislikeComment);
router.patch("/:id/edit", requireAuth, requireCommentAccess({
  ownPermission: Permissions.COMMENTS_EDIT_OWN,
}), commentsController.editComment);
router.delete("/:id/delete", requireAuth, requireCommentAccess({
  ownPermission: Permissions.COMMENTS_DELETE_OWN,
  anyPermission: Permissions.COMMENTS_MODERATE,
}), commentsController.deleteComment);

export default router;
